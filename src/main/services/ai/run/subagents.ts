import { getAssistantToolItemCopy } from '../../../../shared/assistantToolCopy'
import { RUNTIME_TOOL_CATALOG, type RuntimeToolName } from '../../../../shared/runtimeCapabilities'
import { randomUUID } from 'node:crypto'
import { MAX_CONCURRENT_SUBAGENTS } from '../constants'
import type { AiRunDeps, AiRunStartPayload, AiRunState, AiTranscript, SubagentTask } from '../types'
import type { ChatMessageLogRecord, SubagentUpdate } from '../../../../shared/types'
import { terminalSessionManager } from '../human/tools/terminal/TerminalSessionManager'
import { SubagentBlockedError } from './toolPolicy'

export const createMemoryTranscript = (
  partnerId: string,
  runId: string
): AiTranscript & { clear: () => void } => {
  const records: ChatMessageLogRecord[] = []
  return {
    append: async (entries) => {
      for (const entry of entries)
        records.push({
          id: randomUUID(),
          partnerId,
          runId,
          seq: records.length + 1,
          entry,
          createdAt: Date.now()
        })
    },
    load: async () => records.slice(),
    clear: () => {
      records.length = 0
    }
  }
}

export const createSubagentDispatcher = (
  payload: AiRunStartPayload,
  deps: AiRunDeps,
  getModelConfig: () => Promise<import('../../../../shared/types').LlmRuntimeConfig>,
  run: (payload: AiRunStartPayload, deps: AiRunDeps) => Promise<AiRunState>
): NonNullable<AiRunDeps['delegateToSubagent']> => {
  let activeCount = 0
  return async (tasks: SubagentTask[], toolCallId: string) => {
    if (payload.parentToolCallId) throw new SubagentBlockedError('子任务不能再次派发')
    if (!tasks.length || activeCount + tasks.length > MAX_CONCURRENT_SUBAGENTS)
      throw new Error(`每个主任务最多同时运行 ${MAX_CONCURRENT_SUBAGENTS} 个子任务`)
    activeCount += tasks.length
    try {
      const modelConfig = await getModelConfig()
      const results = await Promise.allSettled(
        tasks.map(async (task): Promise<SubagentUpdate> => {
          const childRunId = randomUUID()
          const transcript = createMemoryTranscript(payload.partnerId, childRunId)
          const controller = new AbortController()
          const cancel = (): void => {
            controller.abort()
            void terminalSessionManager.closeByChatSession(childRunId).catch(() => {})
          }
          deps.abortSignal?.addEventListener('abort', cancel, { once: true })
          if (deps.abortSignal?.aborted || deps.isCancelled()) cancel()
          const base: SubagentUpdate = {
            toolCallId,
            childRunId,
            name: task.name,
            task: task.task,
            status: 'running'
          }
          let updates = Promise.resolve()
          let blocker: string | undefined
          const actions = new Map<string, string>()
          let publicToolText = ''
          const publish = (update: SubagentUpdate): Promise<void> => {
            const next = updates.then(async () => {
              await deps.chatMessageLogStore.appendBatch({
                partnerId: payload.partnerId,
                runId: payload.runId,
                entries: [{ kind: 'annotation', eventType: 'subagent_updated', payload: update }]
              })
              deps.sendEvent({
                type: 'subagent_updated',
                runId: payload.runId,
                update,
                createdAt: Date.now()
              })
            })
            updates = next
            // Event emission is synchronous; final delivery awaits the persisted stream.
            void next.catch(() => {})
            return next
          }
          const needParent = (message: string): never => {
            blocker = message
            throw new SubagentBlockedError(message)
          }
          try {
            await publish(base)
            const output = await run(
              {
                ...payload,
                runId: childRunId,
                ownerRunId: payload.ownerRunId || payload.runId,
                parentToolCallId: toolCallId,
                userMessageId: randomUUID(),
                assistantMessageId: randomUUID(),
                input: task.task,
                contentNodes: undefined
              },
              {
                ...deps,
                modelConfig,
                transcript,
                delegateToSubagent: undefined,
                hasPendingUserMessages: undefined,
                waitForPendingUserMessageSubmissions: undefined,
                abortSignal: controller.signal,
                isCancelled: () => controller.signal.aborted || deps.isCancelled(),
                requestApprovalBatch: async () =>
                  needParent('子任务需要人工审批，请由主伙伴继续处理'),
                requestUserQuestion: async () => needParent('子任务需要用户协助，请由主伙伴询问'),
                sendEvent: (event) => {
                  // The thought event is public assistant text accompanying this round of tool calls.
                  // Raw reasoning deltas, skill state and lifecycle remain local.
                  if (
                    event.type === 'assistant_process_group_started' &&
                    event.display.kind === 'thinking'
                  ) {
                    publicToolText = ''
                  } else if (event.type === 'assistant_process_thought') {
                    publicToolText = event.text
                  } else if (event.type === 'tool_call_started') {
                    const toolName = Object.prototype.hasOwnProperty.call(
                      RUNTIME_TOOL_CATALOG,
                      event.toolName
                    )
                      ? (event.toolName as RuntimeToolName)
                      : 'unnamed'
                    const text =
                      publicToolText ||
                      getAssistantToolItemCopy(toolName, 'running', event.input)
                        .detail.map((segment) => segment.text)
                        .join('')
                    actions.set(event.toolCallId, text)
                    void publish({
                      ...base,
                      action: {
                        id: event.toolCallId,
                        toolName: event.toolName,
                        text: actions.get(event.toolCallId) || '',
                        status: 'running'
                      }
                    })
                  } else if (event.type === 'tool_call_result') {
                    void publish({
                      ...base,
                      action: {
                        id: event.toolCallId,
                        toolName: event.toolName,
                        text: actions.get(event.toolCallId) || '',
                        status: event.error || event.result?.ok === false ? 'failed' : 'completed',
                        feedback:
                          event.error ||
                          (typeof event.result?.data === 'object' &&
                          event.result.data &&
                          !Array.isArray(event.result.data) &&
                          typeof event.result.data.message === 'string'
                            ? event.result.data.message.slice(0, 2000)
                            : undefined)
                      }
                    })
                  } else if (event.type === 'browser_panel_opened') {
                    deps.sendEvent({ ...event, runId: payload.runId, background: true })
                  } else if (event.type === 'file_artifact') {
                    deps.sendEvent({ ...event, runId: payload.runId })
                  }
                },
                recordLlmIo: deps.recordLlmIo
                  ? (record) =>
                      deps.recordLlmIo?.({
                        ...record,
                        ownerRunId: payload.runId,
                        parentToolCallId: toolCallId
                      })
                  : undefined
              }
            )
            const update: SubagentUpdate = {
              ...base,
              status:
                blocker || output.needsParent
                  ? 'blocked'
                  : output.status === 'completed'
                    ? 'completed'
                    : output.status === 'cancelled'
                      ? 'cancelled'
                      : 'failed',
              result: (
                blocker ||
                output.finalDeliveryMarkdown ||
                output.error ||
                '执行被中断，未收到完整结果'
              ).slice(0, 12000),
              artifacts: output.finalArtifacts
            }
            await publish(update)
            return update
          } finally {
            try {
              await updates
            } finally {
              transcript.clear()
              deps.abortSignal?.removeEventListener('abort', cancel)
            }
          }
        })
      )
      return results.map((result) => {
        if (result.status === 'rejected') throw result.reason
        return result.value
      })
    } finally {
      activeCount -= tasks.length
    }
  }
}
