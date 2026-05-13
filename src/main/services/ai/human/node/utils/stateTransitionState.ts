import path from 'node:path'
import {
  appendDecisionRound,
  appendRoundRecord,
  buildMouthExecution,
  buildPreExecutionBlockedExecution
} from '../../memory/roundHistory'
import { getToolSpec } from '../../tools/registry'
import type {
  HumanThoughtDecision,
  HumanResult,
  HumanThought,
  HumanState,
  HumanTraceStep,
  HumanWatchHint
} from '../../types'

const DOCX_READ_TOOL_NAMES = new Set(['docx_outline', 'docx_read_blocks'])

const normalizeComparableDocxPath = (sourcePath: string): string =>
  path.posix.normalize(sourcePath.trim().replace(/\\/g, '/')).replace(/^\.\//, '')

const docxPathMatchesReadbackTarget = (input: {
  sourcePath: string
  requestedPath: string
}): boolean => {
  const sourcePath = normalizeComparableDocxPath(input.sourcePath)
  const requestedPath = normalizeComparableDocxPath(input.requestedPath)
  if (!sourcePath || !requestedPath) return false
  return (
    sourcePath === requestedPath ||
    sourcePath.endsWith(`/${requestedPath}`) ||
    requestedPath.endsWith(`/${sourcePath}`)
  )
}

const docxReadSatisfiesWatchHint = (input: {
  thought: HumanThoughtDecision
  watchHint: Extract<HumanWatchHint, { code: 'docx_write_requires_readback' }>
}): boolean => {
  if (input.thought.nextAction.action !== 'hand') return false

  return input.thought.nextAction.toolUsePlan.calls.some((call) => {
    const spec = getToolSpec(call.toolName)
    if (!spec) return false
    const meta = spec.resolveExecutionMeta(call.args)
    if (meta.mutability !== 'read_only' || !DOCX_READ_TOOL_NAMES.has(call.toolName)) return false
    const requestedPath =
      typeof call.args.sourcePath === 'string' ? call.args.sourcePath : undefined
    if (
      requestedPath &&
      input.watchHint.detail.sourcePaths.length > 0 &&
      !input.watchHint.detail.sourcePaths.some((sourcePath) =>
        docxPathMatchesReadbackTarget({
          sourcePath,
          requestedPath
        })
      )
    ) {
      return false
    }
    return true
  })
}

const buildDocxReadbackBlockedHint = (
  watchHint: Extract<HumanWatchHint, { code: 'docx_write_requires_readback' }>
): HumanWatchHint => ({
  code: 'docx_write_requires_readback',
  detail: watchHint.detail
})

export type HumanTraceItemInput = {
  action: HumanTraceStep['action']
  publicNarrative: string
  resultStatus?: HumanTraceStep['resultStatus']
  skillId?: HumanTraceStep['skillId']
  toolName?: string
  summary: string
}

export type HumanStateOverrides<TExcluded extends keyof HumanState = never> = Partial<
  Omit<HumanState, 'execution' | TExcluded>
> & {
  execution?: Partial<HumanState['execution']>
}

const appendHumanTraceSteps = (input: {
  steps: HumanTraceStep[]
  items: HumanTraceItemInput[]
}): HumanTraceStep[] =>
  input.items.reduce(
    (steps, item) =>
      appendHumanTraceStep({
        steps,
        item
      }),
    input.steps
  )

export const appendHumanTraceStep = (input: {
  steps: HumanTraceStep[]
  item: HumanTraceItemInput
}): HumanTraceStep[] => {
  const step = input.steps.length + 1
  return [
    ...input.steps,
    {
      step,
      action: input.item.action,
      publicNarrative: input.item.publicNarrative,
      resultStatus: input.item.resultStatus,
      skillId: input.item.skillId,
      toolName: input.item.toolName,
      summary: input.item.summary
    }
  ]
}

export const returnToBrainState = (
  state: HumanState,
  overrides: HumanStateOverrides = {}
): HumanState => ({
  ...state,
  ...overrides,
  execution: {
    ...state.execution,
    ...overrides.execution,
    stage: 'brain'
  }
})

export const returnToBrainAfterTraceState = (input: {
  state: HumanState
  traceItems: HumanTraceItemInput[]
  watchHint?: HumanWatchHint
  overrides?: HumanStateOverrides<'trace'>
}): HumanState => {
  const traceSteps = appendHumanTraceSteps({
    steps: input.state.trace.steps,
    items: input.traceItems
  })

  return returnToBrainState(input.state, {
    ...input.overrides,
    execution: {
      ...input.overrides?.execution,
      watchHint: input.watchHint
    },
    trace: {
      steps: traceSteps
    }
  })
}

export const resolveBrainDecisionWatchHint = (input: {
  state: HumanState
  thought: HumanThoughtDecision
  thoughtMemory: HumanThought
  watchHint?: HumanWatchHint
}): HumanWatchHint | undefined => {
  if (input.watchHint) return input.watchHint
  if (input.state.execution.watchHint?.code === 'docx_write_requires_readback') {
    if (
      input.thought.nextAction.action === 'hand' &&
      docxReadSatisfiesWatchHint({
        thought: input.thought,
        watchHint: input.state.execution.watchHint
      })
    ) {
      return undefined
    }
    return buildDocxReadbackBlockedHint(input.state.execution.watchHint)
  }
  if (input.thought.nextAction.action !== 'mouth') return undefined

  const pendingItems = (input.thoughtMemory.todolist || [])
    .filter((item) => item.status === 'todo')
    .map((item) => item.item)

  if (input.state.execution.watchHint?.code === 'hand_tool_limit_exceeded') {
    return undefined
  }

  return pendingItems.length > 0
    ? {
        code: 'brain_todolist_incomplete',
        detail: {
          pendingItems
        }
      }
    : undefined
}

const resolveBrainNextStage = (input: {
  watchHint?: HumanWatchHint
  thought: HumanThoughtDecision
}): HumanState['execution']['stage'] => {
  if (input.watchHint) return 'brain'
  return input.thought.nextAction.action === 'learning'
    ? 'learning'
    : input.thought.nextAction.action === 'hand'
      ? 'hand'
      : 'mouth'
}

export const applyBrainDecisionState = (input: {
  state: HumanState
  thought: HumanThoughtDecision
  thoughtMemory: HumanThought
  watchHint?: HumanWatchHint
  createdAt: number
}): HumanState => {
  const references =
    !input.watchHint && input.thought.nextAction.action === 'mouth'
      ? input.thought.nextAction.references
      : undefined

  return {
    ...input.state,
    execution: {
      ...input.state.execution,
      stage: resolveBrainNextStage({
        watchHint: input.watchHint,
        thought: input.thought
      }),
      status: 'running',
      currentThought: input.thought,
      watchHint: input.watchHint,
      references
    },
    memory: {
      thought: input.thoughtMemory,
      history: input.watchHint
        ? appendRoundRecord({
            state: input.state,
            thought: input.thought,
            execution: buildPreExecutionBlockedExecution(input.watchHint),
            createdAt: input.createdAt
          })
        : {
            ...input.state.memory.history
          }
    },
    trace: {
      steps: appendHumanTraceStep({
        steps: input.state.trace.steps,
        item: {
          action: 'brain_decision',
          publicNarrative: input.thought.thought.next,
          resultStatus: 'ok',
          summary: input.thought.thought.next
        }
      })
    }
  }
}

export const buildHumanResult = (input: {
  state: HumanState
  deliveryMarkdown: string
}): HumanResult => ({
  status: 'completed',
  deliveryMarkdown: input.deliveryMarkdown,
  artifacts: input.state.execution.artifacts.length > 0 ? [...input.state.execution.artifacts] : undefined
})

export const completeHumanTaskState = (input: {
  state: HumanState
  result: HumanResult
}): HumanState => ({
  ...input.state,
  execution: {
    ...input.state.execution,
    stage: 'mouth',
    status: 'completed'
  },
  memory: {
    ...input.state.memory,
    history: appendDecisionRound({
      state: input.state,
      execution: buildMouthExecution({
        completed: true
      })
    })
  },
  result: input.result,
  trace: {
      steps: appendHumanTraceStep({
        steps: input.state.trace.steps,
        item: {
          action: 'deliver_result',
          publicNarrative: input.result.deliveryMarkdown,
          resultStatus: 'ok',
          summary: '已完成最终交付'
        }
      })
    }
})
