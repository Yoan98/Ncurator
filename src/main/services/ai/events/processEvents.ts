import type {
  AiRunEvent,
  AssistantProcessDisplay,
  IpcJsonObject,
  RuntimeSkillId
} from '../../../../shared/types'

type SendEvent = (event: AiRunEvent) => void

export const getThinkingProcessGroupId = (runId: string): string => `${runId}:thinking`

export const getLearningProcessGroupId = (runId: string, skillId: RuntimeSkillId): string =>
  `${runId}:learning:${skillId}`

export const getCompactionProcessGroupId = (runId: string): string => `${runId}:compaction`

export const getFinalizingProcessGroupId = (runId: string): string => `${runId}:finalizing`

export const getSkillKeyFromToolName = (toolName: string): string => {
  if (
    toolName === 'docx_outline' ||
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_history' ||
    toolName === 'docx_search'
  ) {
    return 'docx-reader'
  }
  if (toolName === 'docx_edit' || toolName === 'docx_rollback') return 'docx-writer'
  if (toolName === 'kb_search' || toolName === 'kb_list_documents') return 'reference-reader'
  if (toolName === 'terminal_run' || toolName === 'terminal') return 'terminal-runner'
  return 'generic-task'
}

export const getToolProcessGroupId = (runId: string, toolCallId: string): string =>
  `${runId}:tool:${toolCallId}`

export const emitAssistantProcessThought = (input: {
  sendEvent: SendEvent
  runId: string
  text: string
  createdAt?: number
}): void => {
  const text = input.text.trim()
  if (!text) return
  const createdAt = input.createdAt || Date.now()
  input.sendEvent({
    type: 'assistant_process_thought',
    runId: input.runId,
    thoughtId: `${input.runId}:thought:${createdAt}`,
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

export const emitLearningStarted = (input: {
  sendEvent: SendEvent
  runId: string
  skillId: RuntimeSkillId
  createdAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_started',
    runId: input.runId,
    groupId: getLearningProcessGroupId(input.runId, input.skillId),
    kind: 'learning',
    display: { kind: 'learning', skillId: input.skillId },
    createdAt: input.createdAt || Date.now()
  })
}

export const emitLearningCompleted = (input: {
  sendEvent: SendEvent
  runId: string
  skillId: RuntimeSkillId
  completedAt?: number
}): void => {
  input.sendEvent({
    type: 'assistant_process_group_completed',
    runId: input.runId,
    groupId: getLearningProcessGroupId(input.runId, input.skillId),
    display: { kind: 'learning', skillId: input.skillId },
    completedAt: input.completedAt || Date.now()
  })
}

export const emitToolProcessStarted = (input: {
  sendEvent: SendEvent
  runId: string
  toolCallId: string
  toolName: string
  args: IpcJsonObject
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
    kind: 'skill',
    display,
    createdAt: input.createdAt || Date.now()
  })
  input.sendEvent({
    type: 'assistant_process_item_started',
    runId: input.runId,
    groupId: getToolProcessGroupId(input.runId, input.toolCallId),
    itemId: input.toolCallId,
    display,
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
  completedAt?: number
}): void => {
  const groupId = getToolProcessGroupId(input.runId, input.toolCallId)
  if (input.ok) {
    input.sendEvent({
      type: 'assistant_process_item_completed',
      runId: input.runId,
      groupId,
      itemId: input.toolCallId,
      completedAt: input.completedAt || Date.now()
    })
    input.sendEvent({
      type: 'assistant_process_group_completed',
      runId: input.runId,
      groupId,
      completedAt: input.completedAt || Date.now()
    })
    return
  }
  input.sendEvent({
    type: 'assistant_process_item_failed',
    runId: input.runId,
    groupId,
    itemId: input.toolCallId,
    error: input.error,
    failedAt: input.completedAt || Date.now()
  })
  input.sendEvent({
    type: 'assistant_process_group_failed',
    runId: input.runId,
    groupId,
    error: input.error,
    failedAt: input.completedAt || Date.now()
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
