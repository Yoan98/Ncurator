import type { AiRunContext } from '../../../types'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../constants'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { getSkillDefinition, hasSkillDefinition } from '../../skills'
import { ensureSkillTools } from './skillLoader'
import { fitSkillIdsToToolBudget } from './toolBudget'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithWatchHint } from '../utils/stateTransitions'

const buildDuplicateLearnHint = (skillId: string) =>
  `learning 请求重复学习 ${skillId}，已忽略本次学习并返回 brain 重新决策。`

const buildUnknownSkillHint = (skillId: string) =>
  `learning 收到未知 skill ${skillId}，已返回 brain 重新决策。`

const buildToolBudgetHint = (activeToolCount: number) =>
  `learning 请求加载的 skill 会暴露 ${activeToolCount} 个工具，已超过当前 active tool 上限 ${HUMAN_MAX_ACTIVE_TOOLS}，请改为更聚焦的 skill 组合。`

const buildLearnSummary = (input: {
  skillId: string
  activeToolCount: number
  evictedSkillIds: string[]
}) => {
  const budgetSummary =
    input.evictedSkillIds.length > 0
      ? `为满足 active tool 上限 ${HUMAN_MAX_ACTIVE_TOOLS}，已淘汰最早学习的 skill=[${input.evictedSkillIds.join(', ')}]；当前 active tools=${input.activeToolCount}。`
      : `当前 active tools=${input.activeToolCount}。`

  return `learning 已加载 ${input.skillId} 的说明与工具。${budgetSummary}`
}

export const createLearningNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    if (!state.lastBrainDecision || state.lastBrainDecision.nextAction.action !== 'learning') {
      return returnToBrain(state)
    }

    const requestedSkillIds = state.lastBrainDecision.nextAction.wantLearnSkillIds
    const unknownSkillId = requestedSkillIds.find((skillId) => !hasSkillDefinition(skillId))
    if (unknownSkillId) {
      const watchHint = buildUnknownSkillHint(unknownSkillId)
      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'learning',
        watchHint
      })
    }

    const duplicatedSkillId = requestedSkillIds.find((skillId) =>
      state.brainMemory.outside.learnedSkillIds.includes(skillId)
    )
    if (duplicatedSkillId) {
      const watchHint = buildDuplicateLearnHint(duplicatedSkillId)
      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'learning',
        watchHint
      })
    }

    const fittedLearnedSkills = fitSkillIdsToToolBudget({
      existingSkillIds: state.brainMemory.outside.learnedSkillIds,
      requestedSkillIds,
      maxActiveTools: HUMAN_MAX_ACTIVE_TOOLS,
      getToolNames: (skillId) => getSkillDefinition(skillId).toolNames
    })
    if (!fittedLearnedSkills.ok) {
      const watchHint = buildToolBudgetHint(fittedLearnedSkills.activeToolCount)
      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'learning',
        watchHint
      })
    }

    requestedSkillIds.forEach((skillId) => {
      ensureSkillTools({
        cache: input.cache,
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        skillId
      })
    })
    const learnedSkillIds = fittedLearnedSkills.learnedSkillIds
    const nextState = returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      source: 'learning',
      traceItems: requestedSkillIds.map((skillId) => ({
        action: 'learn_skill',
        publicNarrative: `已学习 ${skillId}`,
        resultStatus: 'ok',
        skillId,
        summary: buildLearnSummary({
          skillId,
          activeToolCount: fittedLearnedSkills.activeToolCount,
          evictedSkillIds: fittedLearnedSkills.evictedSkillIds
        })
      })),
      stage: 'human_learning',
      overrides: {
        brainMemory: {
          ...state.brainMemory,
          outside: {
            ...state.brainMemory.outside,
            learnedSkillIds
          }
        }
      }
    })
    return nextState
  }
}
