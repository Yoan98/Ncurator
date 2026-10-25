import type { AiRunContext } from '../../../types'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../constants'
import type {
  HumanToolsetLoadingOutcome,
  HumanRuntimeCache,
  HumanState,
  RuntimeToolsetId
} from '../../types'
import {
  assertExternalLoadedToolsetIds,
  getEffectiveLoadedToolsetIds,
  getToolsetDefinition,
  hasToolsetDefinition,
  isLoadableToolsetId,
  listBuiltinToolsetDefinitions
} from '../../toolsets'
import { ensureToolsetTools } from './toolsetLoader'
import { countActiveToolNamesForToolsetIds, fitToolsetIdsToToolBudget } from './toolBudget'
import { returnToBrainAfterTrace, returnToDispatch } from '../utils/stateTransitions'
import { emitToolCallResult, emitToolCallStarted } from '../../tools/utils/toolEvents'
import { appendToolFeedback } from '../../shared/toolFeedback'

const loadingDisplayData = (
  names: string[],
  outcome: HumanToolsetLoadingOutcome,
  error?: string
) => ({
  toolsetNames: names,
  loadingSuccessfulNames: [...outcome.loadedToolsetIds, ...outcome.skippedDuplicateToolsetIds],
  loadingFailures: names
    .filter(
      (name) =>
        outcome.skippedUnknownToolsetNames.includes(name) ||
        (error && !outcome.skippedDuplicateToolsetIds.includes(name as RuntimeToolsetId))
    )
    .map((name) => ({
      name,
      error: outcome.skippedUnknownToolsetNames.includes(name) ? 'Toolset is not available' : error!
    }))
})

const appendLoadToolsetMessage = async (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  toolCallId: string
  content: string
  toolsetNames: string[]
  outcome: HumanToolsetLoadingOutcome
  error?: string
}): Promise<void> => {
  await appendToolFeedback({
    cache: input.cache,
    ctx: input.ctx,
    toolCallId: input.toolCallId,
    toolName: 'load_toolset',
    ok: !input.error,
    errorMessage: input.error,
    content: input.content,
    displayInput: getToolDisplayInput(
      'load_toolset',
      { toolsetNames: input.toolsetNames },
      loadingDisplayData(input.toolsetNames, input.outcome, input.error)
    )
  })
}

const emitLoadToolsetProcessStarted = (input: {
  ctx: AiRunContext
  toolCallId: string
  toolsetNames: string[]
}): void => {
  emitToolCallStarted({
    ctx: input.ctx,
    runId: input.ctx.runId,
    toolCallId: input.toolCallId,
    toolName: 'load_toolset',
    args: { toolsetNames: input.toolsetNames },
    stage: 'human_toolset_loading'
  })
}

const emitLoadToolsetProcessCompleted = (input: {
  ctx: AiRunContext
  toolCallId: string
  toolsetNames: string[]
  ok: boolean
  error?: string
  outcome: HumanToolsetLoadingOutcome
}): void => {
  emitToolCallResult({
    ctx: input.ctx,
    runId: input.ctx.runId,
    toolCallId: input.toolCallId,
    toolName: 'load_toolset',
    result: {
      toolName: 'load_toolset',
      ok: input.ok,
      data: input.ok
        ? loadingDisplayData(input.toolsetNames, input.outcome)
        : {
            ...loadingDisplayData(input.toolsetNames, input.outcome, input.error),
            error: input.error || 'load_toolset failed'
          }
    },
    error: input.error,
    stage: 'human_toolset_loading'
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
  new Set(listBuiltinToolsetDefinitions().flatMap((definition) => definition.toolNames))
)

const buildLoadSummary = (input: {
  toolsetId: string
  activeToolCount: number
  evictedToolsetIds: string[]
}) => {
  const budgetSummary =
    input.evictedToolsetIds.length > 0
      ? `为满足 active tool 上限 ${HUMAN_MAX_ACTIVE_TOOLS}，已淘汰最早加载的 toolset=[${input.evictedToolsetIds.join(', ')}]；当前 active tools=${input.activeToolCount}。`
      : `当前 active tools=${input.activeToolCount}。`

  return `toolset_loading 已加载 ${input.toolsetId} 的工具组。${budgetSummary}`
}

const buildToolsetLoadingOutcome = (input: {
  requestedToolsetNames: string[]
  loadedToolsetIds: HumanToolsetLoadingOutcome['loadedToolsetIds']
  skippedDuplicateToolsetIds: HumanToolsetLoadingOutcome['skippedDuplicateToolsetIds']
  skippedUnknownToolsetNames: string[]
  evictedToolsetIds: HumanToolsetLoadingOutcome['evictedToolsetIds']
  activeToolCount: number
}): HumanToolsetLoadingOutcome => ({
  requestedToolsetNames: input.requestedToolsetNames,
  loadedToolsetIds: input.loadedToolsetIds,
  skippedDuplicateToolsetIds: input.skippedDuplicateToolsetIds,
  skippedUnknownToolsetNames: input.skippedUnknownToolsetNames,
  evictedToolsetIds: input.evictedToolsetIds,
  activeToolCount: input.activeToolCount
})

const renderToolsetLoadingResult = (outcome: HumanToolsetLoadingOutcome): string => {
  const loaded = outcome.loadedToolsetIds
  const duplicates = outcome.skippedDuplicateToolsetIds
  const unknown = outcome.skippedUnknownToolsetNames
  if (loaded.length > 0) {
    const details = [
      `loaded=${loaded.join(', ')}`,
      duplicates.length > 0 ? `alreadyLoaded=${duplicates.join(', ')}` : undefined,
      unknown.length > 0 ? `unknown=${unknown.join(', ')}` : undefined,
      outcome.evictedToolsetIds.length > 0
        ? `evicted=${outcome.evictedToolsetIds.join(', ')}`
        : undefined
    ].filter(Boolean)
    return `Toolset loading completed successfully. ${details.join('; ')}.`
  }
  if (duplicates.length > 0 && unknown.length === 0) {
    return `No new toolset was loaded. Already loaded: ${duplicates.join(', ')}.`
  }
  if (unknown.length > 0 && duplicates.length === 0) {
    return `Error: Unknown toolset names: ${unknown.join(', ')}.`
  }
  if (duplicates.length > 0 || unknown.length > 0) {
    return `No new toolset was loaded.${duplicates.length > 0 ? ` Already loaded: ${duplicates.join(', ')}.` : ''}${unknown.length > 0 ? ` Unknown toolset names: ${unknown.join(', ')}.` : ''}`
  }
  return 'Error: The toolset request did not contain any loadable toolset.'
}

export const createToolsetLoadingNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLoadedToolsetIds(state.toolsets.loadedToolsetIds)
    input.cache.currentState = state
    const budgetToolNames = BUILTIN_TOOL_NAMES
    const getBudgetToolNames = (toolsetId: RuntimeToolsetId): readonly string[] =>
      getToolsetDefinition(toolsetId).toolNames

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'toolset_loading') {
      return returnToDispatch(state)
    }

    const rawRequestedToolsetNames = pendingRound.nextAction.wantLoadToolsetNames
    const loadToolCallId = pendingRound.nextAction.toolCallId
    const requestedToolsetNames = dedupeInOrder(
      Array.isArray(rawRequestedToolsetNames)
        ? rawRequestedToolsetNames.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0
          )
        : []
    )
    const effectiveLoadedToolsetIds = getEffectiveLoadedToolsetIds(state.toolsets.loadedToolsetIds)
    const duplicateToolsetIds = requestedToolsetNames.filter(
      (toolsetId): toolsetId is HumanToolsetLoadingOutcome['skippedDuplicateToolsetIds'][number] =>
        hasToolsetDefinition(toolsetId) &&
        isLoadableToolsetId(toolsetId) &&
        effectiveLoadedToolsetIds.includes(toolsetId)
    )
    const unknownToolsetNames = requestedToolsetNames.filter(
      (toolsetName) => !hasToolsetDefinition(toolsetName)
    )
    const newToolsetIds = requestedToolsetNames.filter(
      (toolsetId): toolsetId is HumanToolsetLoadingOutcome['loadedToolsetIds'][number] =>
        isLoadableToolsetId(toolsetId) && !state.toolsets.loadedToolsetIds.includes(toolsetId)
    )

    if (newToolsetIds.length === 0) {
      const activeToolCount = countActiveToolNamesForToolsetIds({
        toolsetIds: state.toolsets.loadedToolsetIds,
        getToolNames: getBudgetToolNames,
        baseToolNames: budgetToolNames
      })
      const lastToolsetLoadingOutcome = buildToolsetLoadingOutcome({
        requestedToolsetNames,
        loadedToolsetIds: [],
        skippedDuplicateToolsetIds: duplicateToolsetIds,
        skippedUnknownToolsetNames: unknownToolsetNames,
        evictedToolsetIds: [],
        activeToolCount
      })
      const toolsetLoadingResult = renderToolsetLoadingResult(lastToolsetLoadingOutcome)

      emitLoadToolsetProcessStarted({
        ctx: input.ctx,
        toolCallId: loadToolCallId,
        toolsetNames: requestedToolsetNames
      })
      emitLoadToolsetProcessCompleted({
        ctx: input.ctx,
        toolCallId: loadToolCallId,
        toolsetNames: requestedToolsetNames,
        outcome: lastToolsetLoadingOutcome,
        ok: true
      })
      await appendLoadToolsetMessage({
        cache: input.cache,
        ctx: input.ctx,
        toolCallId: loadToolCallId,
        content: toolsetLoadingResult,
        toolsetNames: requestedToolsetNames,
        outcome: lastToolsetLoadingOutcome
      })
      return returnToDispatch(state, {
        execution: {
          lastToolsetLoadingOutcome
        },
        memory: {
          ...state.memory
        }
      })
    }

    const fittedLoadedToolsets = fitToolsetIdsToToolBudget({
      existingToolsetIds: state.toolsets.loadedToolsetIds,
      requestedToolsetIds: [...duplicateToolsetIds, ...newToolsetIds],
      maxActiveTools: HUMAN_MAX_ACTIVE_TOOLS,
      getToolNames: getBudgetToolNames,
      baseToolNames: budgetToolNames
    })
    if (!fittedLoadedToolsets.ok) {
      const lastToolsetLoadingOutcome = buildToolsetLoadingOutcome({
        requestedToolsetNames,
        loadedToolsetIds: [],
        skippedDuplicateToolsetIds: duplicateToolsetIds,
        skippedUnknownToolsetNames: unknownToolsetNames,
        evictedToolsetIds: [],
        activeToolCount: fittedLoadedToolsets.activeToolCount
      })
      const toolsetLoadingResult =
        'Error: Loading the requested toolsets would exceed the active tool limit.'
      emitLoadToolsetProcessStarted({
        ctx: input.ctx,
        toolCallId: loadToolCallId,
        toolsetNames: requestedToolsetNames
      })
      emitLoadToolsetProcessCompleted({
        ctx: input.ctx,
        toolCallId: loadToolCallId,
        toolsetNames: requestedToolsetNames,
        outcome: lastToolsetLoadingOutcome,
        ok: false,
        error: 'Loading the requested toolsets would exceed the active tool limit.'
      })
      await appendLoadToolsetMessage({
        cache: input.cache,
        ctx: input.ctx,
        toolCallId: loadToolCallId,
        content: toolsetLoadingResult,
        toolsetNames: requestedToolsetNames,
        outcome: lastToolsetLoadingOutcome,
        error: toolsetLoadingResult.slice('Error: '.length)
      })
      return returnToDispatch(state, {
        execution: {
          lastToolsetLoadingOutcome
        },
        memory: {
          ...state.memory
        }
      })
    }

    emitLoadToolsetProcessStarted({
      ctx: input.ctx,
      toolCallId: loadToolCallId,
      toolsetNames: requestedToolsetNames
    })
    await input.ctx.appendMessageLog(
      newToolsetIds.map((toolsetId) => ({
        kind: 'annotation' as const,
        eventType: 'toolset_loading_started' as const,
        payload: { toolsetId }
      }))
    )

    newToolsetIds.forEach((toolsetId) => {
      ensureToolsetTools({
        cache: input.cache,
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        toolsetId
      })
    })
    const loadedToolsetIds = fittedLoadedToolsets.loadedToolsetIds
    const lastToolsetLoadingOutcome = buildToolsetLoadingOutcome({
      requestedToolsetNames,
      loadedToolsetIds: newToolsetIds,
      skippedDuplicateToolsetIds: duplicateToolsetIds,
      skippedUnknownToolsetNames: unknownToolsetNames,
      evictedToolsetIds: fittedLoadedToolsets.evictedToolsetIds,
      activeToolCount: fittedLoadedToolsets.activeToolCount
    })
    const toolsetLoadingResult = renderToolsetLoadingResult(lastToolsetLoadingOutcome)
    await appendLoadToolsetMessage({
      cache: input.cache,
      ctx: input.ctx,
      toolCallId: loadToolCallId,
      content: toolsetLoadingResult,
      toolsetNames: requestedToolsetNames,
      outcome: lastToolsetLoadingOutcome
    })
    emitLoadToolsetProcessCompleted({
      ctx: input.ctx,
      toolCallId: loadToolCallId,
      toolsetNames: requestedToolsetNames,
      outcome: lastToolsetLoadingOutcome,
      ok: true
    })
    await input.ctx.appendMessageLog([
      ...newToolsetIds.map((toolsetId) => ({
        kind: 'annotation' as const,
        eventType: 'toolset_loading_completed' as const,
        payload: { toolsetId }
      })),
      {
        kind: 'annotation' as const,
        eventType: 'toolset_state_updated' as const,
        payload: { loadedToolsetIds: [...loadedToolsetIds] }
      }
    ])
    const nextState = returnToBrainAfterTrace({
      ctx: input.ctx,
      cache: input.cache,
      state,
      traceItems: newToolsetIds.map((toolsetId) => ({
        action: 'load_toolset',
        publicNarrative: `已加载工具组 ${toolsetId}`,
        resultStatus: 'ok',
        toolsetId,
        summary: buildLoadSummary({
          toolsetId,
          activeToolCount: fittedLoadedToolsets.activeToolCount,
          evictedToolsetIds: fittedLoadedToolsets.evictedToolsetIds
        })
      })),
      stage: 'human_toolset_loading',
      overrides: {
        toolsets: {
          loadedToolsetIds
        },
        execution: {
          lastToolsetLoadingOutcome
        },
        memory: {
          ...state.memory
        }
      }
    })
    return nextState
  }
}
import { getToolDisplayInput } from '../../../../../../shared/assistantToolCopy'
