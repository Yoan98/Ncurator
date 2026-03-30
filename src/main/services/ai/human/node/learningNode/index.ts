import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { hasSkillDefinition } from '../../skills'
import { ensureSkillTools } from './skillLoader'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithWatchHint } from '../utils/stateTransitions'

const buildDuplicateLearnHint = (skillId: string) =>
  `learning 请求重复学习 ${skillId}，已忽略本次学习并返回 brain 重新决策。`

const buildUnknownSkillHint = (skillId: string) =>
  `learning 收到未知 skill ${skillId}，已返回 brain 重新决策。`

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

    requestedSkillIds.forEach((skillId) => {
      ensureSkillTools({
        cache: input.cache,
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        skillId
      })
    })
    const learnedSkillIds = [
      ...state.brainMemory.outside.learnedSkillIds,
      ...requestedSkillIds
    ]
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
        summary: `learning 已加载 ${skillId} 的说明与工具。`
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
