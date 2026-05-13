import path from 'node:path'
import {
  appendDecisionRound,
  appendRoundRecord,
  buildMouthExecution,
  buildPreExecutionBlockedExecution
} from '../../memory/rounds'
import { getToolSpec } from '../../tools/registry'
import type {
  HumanThoughtDecision,
  HumanResult,
  HumanThought,
  HumanState,
  HumanTraceStep,
  HumanDecisionHint
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

const docxReadSatisfiesDecisionHint = (input: {
  thought: HumanThoughtDecision
  decisionHint: Extract<HumanDecisionHint, { code: 'docx_write_requires_readback' }>
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
      input.decisionHint.detail.sourcePaths.length > 0 &&
      !input.decisionHint.detail.sourcePaths.some((sourcePath) =>
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
  decisionHint: Extract<HumanDecisionHint, { code: 'docx_write_requires_readback' }>
): HumanDecisionHint => ({
  code: 'docx_write_requires_readback',
  detail: decisionHint.detail
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
  decisionHint?: HumanDecisionHint
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
      pendingDecisionHint: input.decisionHint
    },
    trace: {
      steps: traceSteps
    }
  })
}

export const resolveBrainDecisionHint = (input: {
  state: HumanState
  thought: HumanThoughtDecision
  thoughtMemory: HumanThought
  decisionHint?: HumanDecisionHint
}): HumanDecisionHint | undefined => {
  if (input.decisionHint) return input.decisionHint
  if (input.state.execution.pendingDecisionHint?.code === 'docx_write_requires_readback') {
    if (
      input.thought.nextAction.action === 'hand' &&
      docxReadSatisfiesDecisionHint({
        thought: input.thought,
        decisionHint: input.state.execution.pendingDecisionHint
      })
    ) {
      return undefined
    }
    return buildDocxReadbackBlockedHint(input.state.execution.pendingDecisionHint)
  }
  if (input.thought.nextAction.action !== 'mouth') return undefined

  const pendingItems = (input.thoughtMemory.todolist || [])
    .filter((item) => item.status === 'todo')
    .map((item) => item.item)

  if (input.state.execution.pendingDecisionHint?.code === 'hand_tool_limit_exceeded') {
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
  decisionHint?: HumanDecisionHint
  thought: HumanThoughtDecision
}): HumanState['execution']['stage'] => {
  if (input.decisionHint) return 'brain'
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
  decisionHint?: HumanDecisionHint
  createdAt: number
}): HumanState => {
  const references =
    !input.decisionHint && input.thought.nextAction.action === 'mouth'
      ? input.thought.nextAction.references
      : undefined

  return {
    ...input.state,
    execution: {
      ...input.state.execution,
      stage: resolveBrainNextStage({
        decisionHint: input.decisionHint,
        thought: input.thought
      }),
      status: 'running',
      currentThought: input.thought,
      pendingDecisionHint: input.decisionHint,
      references
    },
    memory: {
      ...input.state.memory,
      thought: input.thoughtMemory,
      taskRun: input.decisionHint
        ? appendRoundRecord({
            state: input.state,
            thought: input.thought,
            execution: buildPreExecutionBlockedExecution(input.decisionHint),
            createdAt: input.createdAt
          })
        : {
            ...input.state.memory.taskRun
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
    taskRun: appendDecisionRound({
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
