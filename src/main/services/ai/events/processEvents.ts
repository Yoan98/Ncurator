import type { AiRunEvent, AssistantProcessDisplay, IpcJsonObject } from '../../../../shared/types'

type SendEvent = (event: AiRunEvent) => void

const getThinkingProcessGroupId = (runId: string): string => `${runId}:thinking`

const getCompactionProcessGroupId = (runId: string): string => `${runId}:compaction`

const getFinalizingProcessGroupId = (runId: string): string => `${runId}:finalizing`

const getToolProcessGroupId = (runId: string, toolCallId: string): string =>
  `${runId}:tool:${toolCallId}`

const getLlmRetryProcessGroupId = (runId: string): string => `${runId}:llm-retry`

export const emitAssistantProcessThought = (input: {
  sendEvent: SendEvent
  runId: string
  text: string
  /** Stable id for this brain round; preferred over createdAt to avoid same-ms collisions. */
  thoughtId?: string
  createdAt?: number
}): void => {
  const text = input.text.trim()
  if (!text) return
  const createdAt = input.createdAt || Date.now()
  input.sendEvent({
    type: 'assistant_process_thought',
    runId: input.runId,
    thoughtId: input.thoughtId || `${input.runId}:thought:${createdAt}`,
    text,
    createdAt
  })
}

export const emitThinkingStarted = (input: {
  sendEvent: SendEvent
  runId: string
  createdAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_started',
    runId: input.runId,
    groupId: getThinkingProcessGroupId(input.runId),
    kind: 'thinking',
    display: { kind: 'thinking' },
    createdAt: input.createdAt || Date.now()
  })
}

export const emitThinkingCompleted = (input: {
  sendEvent: SendEvent
  runId: string
  completedAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_completed',
    runId: input.runId,
    groupId: getThinkingProcessGroupId(input.runId),
    display: { kind: 'thinking' },
    completedAt: input.completedAt || Date.now()
  })
}

export const emitThinkingFailed = (input: {
  sendEvent: SendEvent
  runId: string
  error?: string
  failedAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_failed',
    runId: input.runId,
    groupId: getThinkingProcessGroupId(input.runId),
    display: { kind: 'thinking' },
    error: input.error,
    failedAt: input.failedAt || Date.now()
  })
}

export const emitToolProcessStarted = (input: {
  sendEvent: SendEvent
  runId: string
  toolCallId: string
  toolName: string
  args: IpcJsonObject
  terminalReviewState?: 'reviewing' | 'ready_to_execute' | 'waiting_approval' | 'not_executed'
  createdAt?: number
}): void => {
  const display: AssistantProcessDisplay = {
    kind: 'tool',
    toolName: input.toolName,
    input: input.args
  }
  input.sendEvent({
    type: 'assistant_process_group_started',
    runId: input.runId,
    groupId: getToolProcessGroupId(input.runId, input.toolCallId),
    kind: 'toolset',
    display,
    createdAt: input.createdAt || Date.now()
  })
  input.sendEvent({
    type: 'assistant_process_item_started',
    runId: input.runId,
    groupId: getToolProcessGroupId(input.runId, input.toolCallId),
    itemId: input.toolCallId,
    display,
    terminalReviewState: input.terminalReviewState ?? null,
    createdAt: input.createdAt || Date.now()
  })
}

export const emitToolProcessCompleted = (input: {
  sendEvent: SendEvent
  runId: string
  toolCallId: string
  toolName: string
  ok: boolean
  error?: string
  displayInput?: IpcJsonObject
  completedAt?: number
}): void => {
  const groupId = getToolProcessGroupId(input.runId, input.toolCallId)
  const display: AssistantProcessDisplay | undefined = input.displayInput
    ? { kind: 'tool', toolName: input.toolName, input: input.displayInput }
    : undefined
  if (input.ok) {
    input.sendEvent({
      type: 'assistant_process_item_completed',
      runId: input.runId,
      groupId,
      itemId: input.toolCallId,
      display,
      completedAt: input.completedAt || Date.now()
    })
    input.sendEvent({
      type: 'assistant_process_group_completed',
      runId: input.runId,
      groupId,
      display,
      completedAt: input.completedAt || Date.now()
    })
    return
  }
  input.sendEvent({
    type: 'assistant_process_item_failed',
    runId: input.runId,
    groupId,
    itemId: input.toolCallId,
    display,
    error: input.error,
    failedAt: input.completedAt || Date.now()
  })
  input.sendEvent({
    type: 'assistant_process_group_failed',
    runId: input.runId,
    groupId,
    display,
    error: input.error,
    failedAt: input.completedAt || Date.now()
  })
}

export const emitLlmRetryProcessStarted = (input: {
  sendEvent: SendEvent
  runId: string
  callId: string
  attempt: number
  maxAttempts: number
  message: string
  createdAt?: number
}): void => {
  const createdAt = input.createdAt || Date.now()
  const groupId = getLlmRetryProcessGroupId(input.runId)
  const display: AssistantProcessDisplay = {
    kind: 'retry',
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    message: input.message
  }
  input.sendEvent({
    type: 'assistant_process_group_started',
    runId: input.runId,
    groupId,
    kind: 'retry',
    display,
    createdAt
  })
  input.sendEvent({
    type: 'assistant_process_item_started',
    runId: input.runId,
    groupId,
    itemId: `${groupId}:message`,
    display,
    createdAt
  })
}

export const emitLlmRetryProcessCompleted = (input: {
  sendEvent: SendEvent
  runId: string
  callId: string
  completedAt?: number
}): void => {
  const groupId = getLlmRetryProcessGroupId(input.runId)
  const completedAt = input.completedAt || Date.now()
  input.sendEvent({
    type: 'assistant_process_item_completed',
    runId: input.runId,
    groupId,
    itemId: `${groupId}:message`,
    completedAt
  })
  input.sendEvent({
    type: 'assistant_process_group_completed',
    runId: input.runId,
    groupId,
    completedAt
  })
}

export const emitLlmRetryProcessFailed = (input: {
  sendEvent: SendEvent
  runId: string
  callId: string
  error?: string
  failedAt?: number
}): void => {
  const groupId = getLlmRetryProcessGroupId(input.runId)
  const failedAt = input.failedAt || Date.now()
  input.sendEvent({
    type: 'assistant_process_item_failed',
    runId: input.runId,
    groupId,
    itemId: `${groupId}:message`,
    error: input.error,
    failedAt
  })
  input.sendEvent({
    type: 'assistant_process_group_failed',
    runId: input.runId,
    groupId,
    error: input.error,
    failedAt
  })
}

export const emitCompactionStarted = (input: {
  sendEvent: SendEvent
  runId: string
  createdAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_started',
    runId: input.runId,
    groupId: getCompactionProcessGroupId(input.runId),
    kind: 'compaction',
    display: { kind: 'compaction' },
    createdAt: input.createdAt || Date.now()
  })
}

export const emitCompactionCompleted = (input: {
  sendEvent: SendEvent
  runId: string
  completedAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_completed',
    runId: input.runId,
    groupId: getCompactionProcessGroupId(input.runId),
    display: { kind: 'compaction' },
    completedAt: input.completedAt || Date.now()
  })
}

export const emitFinalizingStarted = (input: {
  sendEvent: SendEvent
  runId: string
  createdAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_started',
    runId: input.runId,
    groupId: getFinalizingProcessGroupId(input.runId),
    kind: 'finalizing',
    display: { kind: 'finalizing' },
    createdAt: input.createdAt || Date.now()
  })
}
