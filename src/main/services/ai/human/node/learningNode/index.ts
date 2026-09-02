import type { AiRunContext } from '../../../types'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../constants'
import type {
  HumanLearningOutcome,
  HumanRuntimeCache,
  HumanState,
  RuntimeSkillId
} from '../../types'
import {
  assertExternalLearnedSkillIds,
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  hasSkillDefinition,
  isLearnableSkillId,
  listBuiltinSkillDefinitions
} from '../../skills'
import { ensureSkillTools } from './skillLoader'
import { countActiveToolNamesForSkillIds, fitSkillIdsToToolBudget } from './toolBudget'
import { returnToBrainAfterTrace, returnToDispatch } from '../utils/stateTransitions'
import { emitLearningCompleted, emitLearningStarted } from '../../../events/processEvents'
import { appendToolFeedback } from '../../shared/toolFeedback'

const appendLearnToolMessage = async (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  toolCallId: string
  content: string
}): Promise<void> => {
  await appendToolFeedback({
    cache: input.cache,
    ctx: input.ctx,
    toolCallId: input.toolCallId,
    toolName: 'learn_skill',
    ok: true,
    content: input.content
  })
}

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

const BUILTIN_TOOL_NAMES = Array.from(
  new Set(listBuiltinSkillDefinitions().flatMap((definition) => definition.toolNames))
)

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

const renderLearningResult = (outcome: HumanLearningOutcome): string => {
  const loaded = outcome.loadedSkillIds
  const duplicates = outcome.skippedDuplicateSkillIds
  const unknown = outcome.skippedUnknownSkillIds
  if (loaded.length > 0) {
    const details = [
      `loaded=${loaded.join(', ')}`,
      duplicates.length > 0 ? `alreadyLoaded=${duplicates.join(', ')}` : undefined,
      unknown.length > 0 ? `unknown=${unknown.join(', ')}` : undefined,
      outcome.evictedSkillIds.length > 0
        ? `evicted=${outcome.evictedSkillIds.join(', ')}`
        : undefined
    ].filter(Boolean)
    return `Skill loading completed successfully. ${details.join('; ')}.`
  }
  if (duplicates.length > 0 && unknown.length === 0) {
    return `No new skill was loaded. Already loaded: ${duplicates.join(', ')}.`
  }
  if (unknown.length > 0 && duplicates.length === 0) {
    return `Error: Unknown skill IDs: ${unknown.join(', ')}.`
  }
  if (duplicates.length > 0 || unknown.length > 0) {
    return `No new skill was loaded.${duplicates.length > 0 ? ` Already loaded: ${duplicates.join(', ')}.` : ''}${unknown.length > 0 ? ` Unknown skill IDs: ${unknown.join(', ')}.` : ''}`
  }
  return 'Error: The skill request did not contain any loadable skill.'
}

export const createLearningNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state
    const budgetToolNames = BUILTIN_TOOL_NAMES
    const getBudgetToolNames = (skillId: RuntimeSkillId): readonly string[] =>
      getSkillDefinition(skillId).toolNames

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'learning') {
      return returnToDispatch(state)
    }

    const rawRequestedSkillIds = pendingRound.nextAction.wantLearnSkillIds
    const learnToolCallId = pendingRound.nextAction.toolCallId
    const directRequestedSkillIds = dedupeInOrder(
      Array.isArray(rawRequestedSkillIds)
        ? rawRequestedSkillIds.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0
          )
        : []
    )
    const requestedSkillIds = directRequestedSkillIds
    const effectiveLearnedSkillIds = getEffectiveLearnedSkillIds(state.skills.learnedSkillIds)
    const duplicateSkillIds = requestedSkillIds.filter(
      (skillId): skillId is HumanLearningOutcome['skippedDuplicateSkillIds'][number] =>
        hasSkillDefinition(skillId) &&
        isLearnableSkillId(skillId) &&
        effectiveLearnedSkillIds.includes(skillId)
    )
    const unknownSkillIds = requestedSkillIds.filter((skillId) => !hasSkillDefinition(skillId))
    const newSkillIds = requestedSkillIds.filter(
      (skillId): skillId is HumanLearningOutcome['loadedSkillIds'][number] =>
        isLearnableSkillId(skillId) && !state.skills.learnedSkillIds.includes(skillId)
    )

    if (newSkillIds.length === 0) {
      const activeToolCount = countActiveToolNamesForSkillIds({
        skillIds: state.skills.learnedSkillIds,
        getToolNames: getBudgetToolNames,
        baseToolNames: budgetToolNames
      })
      const lastLearningOutcome = buildLearningOutcome({
        requestedSkillIds,
        loadedSkillIds: [],
        skippedDuplicateSkillIds: duplicateSkillIds,
        skippedUnknownSkillIds: unknownSkillIds,
        evictedSkillIds: [],
        activeToolCount
      })
      const learningResult = renderLearningResult(lastLearningOutcome)

      await appendLearnToolMessage({
        cache: input.cache,
        ctx: input.ctx,
        toolCallId: learnToolCallId,
        content: learningResult
      })
      return returnToDispatch(state, {
        execution: {
          lastLearningOutcome
        },
        memory: {
          ...state.memory
        }
      })
    }

    const fittedLearnedSkills = fitSkillIdsToToolBudget({
      existingSkillIds: state.skills.learnedSkillIds,
      requestedSkillIds: [...duplicateSkillIds, ...newSkillIds],
      maxActiveTools: HUMAN_MAX_ACTIVE_TOOLS,
      getToolNames: getBudgetToolNames,
      baseToolNames: budgetToolNames
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
      const learningResult =
        'Error: Loading the requested skills would exceed the active tool limit.'
      await appendLearnToolMessage({
        cache: input.cache,
        ctx: input.ctx,
        toolCallId: learnToolCallId,
        content: learningResult
      })
      return returnToDispatch(state, {
        execution: {
          lastLearningOutcome
        },
        memory: {
          ...state.memory
        }
      })
    }

    newSkillIds.forEach((skillId) => {
      emitLearningStarted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId,
        skillId
      })
    })
    await input.ctx.appendMessageLog(
      newSkillIds.map((skillId) => ({
        kind: 'annotation' as const,
        eventType: 'learning_started' as const,
        payload: { skillId }
      }))
    )

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
    const learningResult = renderLearningResult(lastLearningOutcome)
    await appendLearnToolMessage({
      cache: input.cache,
      ctx: input.ctx,
      toolCallId: learnToolCallId,
      content: learningResult
    })
    newSkillIds.forEach((skillId) => {
      emitLearningCompleted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId,
        skillId
      })
    })
    await input.ctx.appendMessageLog([
      ...newSkillIds.map((skillId) => ({
        kind: 'annotation' as const,
        eventType: 'learning_completed' as const,
        payload: { skillId }
      })),
      {
        kind: 'annotation' as const,
        eventType: 'skill_state_updated' as const,
        payload: { learnedSkillIds: [...learnedSkillIds] }
      }
    ])
    const nextState = returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
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
          ...state.memory
        }
      }
    })
    return nextState
  }
}
