import type { AiRunContext } from '../../../types'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../constants'
import type { HumanLearningOutcome, HumanRuntimeCache, HumanState, HumanWatchHint } from '../../types'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  hasSkillDefinition,
  isLearnableSkillId
} from '../../skills'
import { appendDecisionRound, buildLearningExecution } from '../../memory/roundHistory'
import { ensureSkillTools } from './skillLoader'
import { countActiveToolNamesForSkillIds, fitSkillIdsToToolBudget } from './toolBudget'
import { returnToBrain, returnToBrainAfterTrace, returnToBrainWithWatchHint } from '../utils/stateTransitions'

const dedupeInOrder = <TValue extends string>(values: readonly TValue[]): TValue[] => {
  const out: TValue[] = []
  const seen = new Set<TValue>()

  values.forEach((value) => {
    if (seen.has(value)) return
    seen.add(value)
    out.push(value)
  })

  return out
}

const buildNoEffectWatchHint = (input: {
  requestedSkillIds: string[]
  duplicateSkillIds: HumanLearningOutcome['skippedDuplicateSkillIds']
  unknownSkillIds: string[]
}): HumanWatchHint => ({
  code: 'learning_no_effect',
  detail: {
    requestedSkillIds: input.requestedSkillIds,
    duplicateSkillIds: input.duplicateSkillIds,
    unknownSkillIds: input.unknownSkillIds
  }
})

const buildToolBudgetWatchHint = (input: {
  requestedSkillIds: string[]
  activeToolCount: number
}): HumanWatchHint => ({
  code: 'learning_tool_budget_exceeded',
  detail: {
    requestedSkillIds: input.requestedSkillIds,
    activeToolCount: input.activeToolCount,
    limit: HUMAN_MAX_ACTIVE_TOOLS
  }
})

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

const buildLearningOutcome = (input: {
  requestedSkillIds: string[]
  loadedSkillIds: HumanLearningOutcome['loadedSkillIds']
  skippedDuplicateSkillIds: HumanLearningOutcome['skippedDuplicateSkillIds']
  skippedUnknownSkillIds: string[]
  evictedSkillIds: HumanLearningOutcome['evictedSkillIds']
  activeToolCount: number
}): HumanLearningOutcome => ({
  requestedSkillIds: input.requestedSkillIds,
  loadedSkillIds: input.loadedSkillIds,
  skippedDuplicateSkillIds: input.skippedDuplicateSkillIds,
  skippedUnknownSkillIds: input.skippedUnknownSkillIds,
  evictedSkillIds: input.evictedSkillIds,
  activeToolCount: input.activeToolCount
})

export const createLearningNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    if (!state.execution.currentDecision || state.execution.currentDecision.nextAction.action !== 'learning') {
      return returnToBrain(state)
    }

    const requestedSkillIds = dedupeInOrder(state.execution.currentDecision.nextAction.wantLearnSkillIds)
    const effectiveLearnedSkillIds = getEffectiveLearnedSkillIds(state.skills.learnedSkillIds)
    const duplicateSkillIds = requestedSkillIds.filter(
      (skillId): skillId is HumanLearningOutcome['skippedDuplicateSkillIds'][number] =>
        hasSkillDefinition(skillId) && effectiveLearnedSkillIds.includes(skillId)
    )
    const unknownSkillIds = requestedSkillIds.filter((skillId) => !hasSkillDefinition(skillId))
    const newSkillIds = requestedSkillIds.filter(
      (skillId): skillId is HumanLearningOutcome['loadedSkillIds'][number] =>
        isLearnableSkillId(skillId) && !state.skills.learnedSkillIds.includes(skillId)
    )

    if (newSkillIds.length === 0) {
      const activeToolCount = countActiveToolNamesForSkillIds({
        skillIds: state.skills.learnedSkillIds,
        getToolNames: (skillId) => getSkillDefinition(skillId).toolNames
      })
      const lastLearningOutcome = buildLearningOutcome({
        requestedSkillIds,
        loadedSkillIds: [],
        skippedDuplicateSkillIds: duplicateSkillIds,
        skippedUnknownSkillIds: unknownSkillIds,
        evictedSkillIds: [],
        activeToolCount
      })

      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'learning',
        watchHint: buildNoEffectWatchHint({
          requestedSkillIds,
          duplicateSkillIds,
          unknownSkillIds
        }),
        overrides: {
          execution: {
            lastLearningOutcome
          },
          memory: {
            ...state.memory,
            history: appendDecisionRound({
              state,
              execution: buildLearningExecution({
                learningOutcome: lastLearningOutcome,
                watchHint: buildNoEffectWatchHint({
                  requestedSkillIds,
                  duplicateSkillIds,
                  unknownSkillIds
                })
              })
            })
          }
        }
      })
    }

    const fittedLearnedSkills = fitSkillIdsToToolBudget({
      existingSkillIds: state.skills.learnedSkillIds,
      requestedSkillIds: [...duplicateSkillIds, ...newSkillIds],
      maxActiveTools: HUMAN_MAX_ACTIVE_TOOLS,
      getToolNames: (skillId) => getSkillDefinition(skillId).toolNames
    })
    if (!fittedLearnedSkills.ok) {
      const lastLearningOutcome = buildLearningOutcome({
        requestedSkillIds,
        loadedSkillIds: [],
        skippedDuplicateSkillIds: duplicateSkillIds,
        skippedUnknownSkillIds: unknownSkillIds,
        evictedSkillIds: [],
        activeToolCount: fittedLearnedSkills.activeToolCount
      })
      return returnToBrainWithWatchHint({
        ctx: input.ctx,
        state,
        source: 'learning',
        watchHint: buildToolBudgetWatchHint({
          requestedSkillIds,
          activeToolCount: fittedLearnedSkills.activeToolCount
        }),
        overrides: {
          execution: {
            lastLearningOutcome
          },
          memory: {
            ...state.memory,
            history: appendDecisionRound({
              state,
              execution: buildLearningExecution({
                learningOutcome: lastLearningOutcome,
                watchHint: buildToolBudgetWatchHint({
                  requestedSkillIds,
                  activeToolCount: fittedLearnedSkills.activeToolCount
                })
              })
            })
          }
        }
      })
    }

    newSkillIds.forEach((skillId) => {
      ensureSkillTools({
        cache: input.cache,
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        skillId
      })
    })
    const learnedSkillIds = fittedLearnedSkills.learnedSkillIds
    const lastLearningOutcome = buildLearningOutcome({
      requestedSkillIds,
      loadedSkillIds: newSkillIds,
      skippedDuplicateSkillIds: duplicateSkillIds,
      skippedUnknownSkillIds: unknownSkillIds,
      evictedSkillIds: fittedLearnedSkills.evictedSkillIds,
      activeToolCount: fittedLearnedSkills.activeToolCount
    })
    const nextState = returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      source: 'learning',
      traceItems: newSkillIds.map((skillId) => ({
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
        skills: {
          learnedSkillIds
        },
        execution: {
          lastLearningOutcome
        },
        memory: {
          ...state.memory,
          history: appendDecisionRound({
            state,
            execution: buildLearningExecution({
              learningOutcome: lastLearningOutcome
            })
          })
        }
      }
    })
    return nextState
  }
}
