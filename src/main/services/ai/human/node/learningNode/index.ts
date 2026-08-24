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
import {
  returnToBrain,
  returnToBrainAfterTrace
} from '../utils/stateTransitions'
import { advanceDispatchState } from '../dispatch'
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
    result: { message: input.content }
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
      `已加载技能 ${loaded.map((item) => `\`${item}\``).join('、')}`,
      duplicates.length > 0
        ? `已存在技能 ${duplicates.map((item) => `\`${item}\``).join('、')}`
        : undefined,
      unknown.length > 0
        ? `未识别技能 ${unknown.map((item) => `\`${item}\``).join('、')}`
        : undefined,
      outcome.evictedSkillIds.length > 0
        ? `为满足活动工具数量上限，已移除技能 ${outcome.evictedSkillIds.map((item) => `\`${item}\``).join('、')}`
        : undefined
    ].filter(Boolean)
    return `学习${duplicates.length > 0 || unknown.length > 0 ? '部分' : ''}成功，${details.join('；')}。`
  }
  if (duplicates.length > 0 && unknown.length === 0) {
    return `学习失败，请求的技能 ${duplicates.map((item) => `\`${item}\``).join('、')} 已经加载，本轮没有获得新能力。`
  }
  if (unknown.length > 0 && duplicates.length === 0) {
    return `学习失败，未识别请求的技能 ${unknown.map((item) => `\`${item}\``).join('、')}。`
  }
  if (duplicates.length > 0 || unknown.length > 0) {
    return `学习失败，本轮没有加载新技能；${duplicates.length > 0 ? `技能 ${duplicates.map((item) => `\`${item}\``).join('、')} 已经存在` : ''}${duplicates.length > 0 && unknown.length > 0 ? '；' : ''}${unknown.length > 0 ? `技能 ${unknown.map((item) => `\`${item}\``).join('、')} 未被识别` : ''}。`
  }
  return '学习失败，学习请求中没有可加载的技能。'
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
      return advanceDispatchState(state)
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
      return returnToBrain(state, {
        execution: {
          lastLearningOutcome,
          pendingDispatch: undefined,
          stage: 'context_budget'
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
      const learningResult = '学习失败，加载请求中的技能后会超过当前活动工具数量上限。'
      await appendLearnToolMessage({
        cache: input.cache,
        ctx: input.ctx,
        toolCallId: learnToolCallId,
        content: learningResult
      })
      return returnToBrain(state, {
        execution: {
          lastLearningOutcome,
          pendingDispatch: undefined,
          stage: 'context_budget'
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
    const sessionSkillState = await input.ctx.loadSessionSkillState()
    await input.ctx.saveSessionSkillState({
      expectedRevision: sessionSkillState.revision,
      learnedSkillIds
    })
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
    newSkillIds.forEach((skillId) => {
      emitLearningCompleted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId,
        skillId
      })
    })
    await input.ctx.appendMessageLog(
      newSkillIds.map((skillId) => ({
        kind: 'annotation' as const,
        eventType: 'learning_completed' as const,
        payload: { skillId }
      }))
    )
    return nextState
  }
}
