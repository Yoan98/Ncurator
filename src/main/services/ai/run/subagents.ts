import { getAssistantToolItemCopy } from '../../../../shared/assistantToolCopy'
import { RUNTIME_TOOL_CATALOG, type RuntimeToolName } from '../../../../shared/runtimeCapabilities'
import { randomUUID } from 'node:crypto'
import { SUBAGENT_EXECUTION_CONCURRENCY } from '../constants'
import type { AiRunDeps, AiRunStartPayload, AiRunState, SubagentAssignment } from '../types'
import type { SubagentUpdate } from '../../../../shared/types'
import { terminalSessionManager } from '../human/tools/terminal/TerminalSessionManager'
import { SubagentBlockedError } from './toolPolicy'

export const createSubagentDispatcher = (
  payload: AiRunStartPayload,
  deps: AiRunDeps,
  getModelConfig: () => Promise<import('../../../../shared/types').LlmRuntimeConfig>,
  run: (payload: AiRunStartPayload, deps: AiRunDeps) => Promise<AiRunState>
): NonNullable<AiRunDeps['delegateToSubagent']> => {
  let activeCount = 0
  const pending: Array<() => Promise<void>> = []
  let queueAbortBound = false
  const cancelPending = (): void => {
    deps.abortSignal?.removeEventListener('abort', cancelPending)
    queueAbortBound = false
    const cancelled = pending.splice(0)
    // Each job observes cancellation before allocating a transcript or run resources.
    for (const job of cancelled) void job()
  }
  const drain = (): void => {
    while (activeCount < SUBAGENT_EXECUTION_CONCURRENCY && pending.length) {
      const job = pending.shift()!
      activeCount += 1
      void job().finally(() => {
        activeCount -= 1
        drain()
      })
    }
    if (!pending.length && queueAbortBound) {
      deps.abortSignal?.removeEventListener('abort', cancelPending)
      queueAbortBound = false
    }
  }
  const schedule = (execute: () => Promise<SubagentUpdate>): Promise<SubagentUpdate> =>
    new Promise((resolve, reject) => {
      const job = async (): Promise<void> => {
        try {
          resolve(await execute())
        } catch (error) {
          reject(error)
        }
      }
      if (deps.abortSignal?.aborted || deps.isCancelled()) {
        void job()
      } else {
        pending.push(job)
        if (!queueAbortBound && deps.abortSignal) {
          queueAbortBound = true
          deps.abortSignal.addEventListener('abort', cancelPending, { once: true })
        }
        drain()
      }
    })
  return async (assignments: SubagentAssignment[], toolCallId: string) => {
    if (payload.parentToolCallId) throw new SubagentBlockedError('子任务不能再次派发')
    if (!assignments.length) throw new Error('子助手分配列表不能为空')
    const modelConfig = await getModelConfig()
    const agents = deps.subagentStore.enqueue(payload.partnerId, assignments)
    const results = await Promise.allSettled(
      assignments.map(async (assignment, index): Promise<SubagentUpdate> => {
        const agent = agents[index]
        const childRunId = randomUUID()
        let base: SubagentUpdate = {
          agentId: agent.agentId,
          toolCallId,
          childRunId,
          name: agent.name,
          task: agent.task,
          status: 'queued'
        }
        let updates = Promise.resolve()
        let blocker: string | undefined
        const actions = new Map<string, { text: string; messageId: string }>()
        let publicToolText = ''
        let finished = false
        const publish = (update: SubagentUpdate): Promise<void> => {
          const next = updates.then(async () => {
            deps.subagentStore.publish(
              deps.chatMessageLogStore,
              payload.partnerId,
              payload.runId,
              update
            )
            deps.sendEvent({
              type: 'subagent_updated',
              runId: payload.runId,
              update,
              createdAt: Date.now()
            })
          })
          // A failed snapshot must not prevent persisting the subsequent failure state.
          updates = next.catch(() => {})
          return next
        }
        const needParent = (message: string): never => {
          blocker = message
          throw new SubagentBlockedError(message)
        }
        await publish(base)
        return await schedule(async () => {
          if (deps.abortSignal?.aborted || deps.isCancelled()) {
            const cancelled: SubagentUpdate = { ...base, status: 'cancelled', result: '已停止' }
            await publish(cancelled)
            return cancelled
          }
          base = { ...base, status: 'running' }
          const controller = new AbortController()
          const cancel = (): void => {
            controller.abort()
            void terminalSessionManager.closeByChatSession(childRunId).catch(() => {})
          }
          deps.abortSignal?.addEventListener('abort', cancel, { once: true })
          if (deps.abortSignal?.aborted || deps.isCancelled()) cancel()
          let replaceStream = true
          let messageId: string = randomUUID()
          const stream = (update: {
            delta?: string
            reset?: boolean
            streaming?: boolean
          }): void => {
            // Keep live fragments ordered with durable snapshots without persisting each fragment.
            const streamMessageId = messageId
            const next = updates.then(() => {
              deps.sendEvent({
                type: 'subagent_stream',
                runId: payload.runId,
                toolCallId,
                childRunId,
                messageId: streamMessageId,
                ...update,
                createdAt: Date.now()
              })
            })
            updates = next
            void next.catch(() => {})
          }
          try {
            await publish(base)
            // A task cancelled while queued has no graph messages yet; preserve its original input on first execution.
            const input =
              assignment.agentId &&
              !(await deps.chatMessageLogStore.list(payload.partnerId, agent.agentId)).length
                ? `原任务：${agent.task}\n\n本次任务：${assignment.instruction}`
                : assignment.instruction
            const output = await run(
              {
                ...payload,
                runId: childRunId,
                subagentId: agent.agentId,
                ownerRunId: payload.ownerRunId || payload.runId,
                parentToolCallId: toolCallId,
                userMessageId: randomUUID(),
                assistantMessageId: randomUUID(),
                input,
                contentNodes: undefined
              },
              {
                ...deps,
                modelConfig,
                delegateToSubagent: undefined,
                hasPendingUserMessages: undefined,
                waitForPendingUserMessageSubmissions: undefined,
                abortSignal: controller.signal,
                isCancelled: () => controller.signal.aborted || deps.isCancelled(),
                requestApprovalBatch: async (request) => {
                  base = { ...base, status: 'waiting_approval' }
                  stream({ streaming: false })
                  await publish(base)
                  const result = await deps.requestApprovalBatch({
                    ...request,
                    source: {
                      agentId: agent.agentId,
                      childRunId,
                      name: agent.name,
                      parentToolCallId: toolCallId
                    },
                    abortSignal: controller.signal
                  })
                  if (!controller.signal.aborted && !deps.isCancelled()) {
                    base = { ...base, status: 'running' }
                    await publish(base)
                  }
                  return result
                },
                requestUserQuestion: async () => needParent('子任务需要用户协助，请由主伙伴询问'),
                sendEvent: (event) => {
                  // Tool cleanup may finish after cancellation or graph completion.
                  if (finished || controller.signal.aborted || deps.isCancelled()) return
                  // The thought event is public assistant text accompanying this round of tool calls.
                  // Raw reasoning deltas, toolset state and lifecycle remain local.
                  if (event.type === 'assistant_brain_stream_started') {
                    replaceStream = true
                    messageId = event.roundId
                  } else if (event.type === 'assistant_brain_stream_reset') {
                    replaceStream = true
                    messageId = randomUUID()
                    stream({ reset: true, streaming: false })
                  } else if (event.type === 'assistant_brain_stream_delta') {
                    stream({ delta: event.text, reset: replaceStream, streaming: true })
                    replaceStream = false
                  } else if (event.type === 'assistant_brain_stream_completed') {
                    stream({ streaming: false })
                    if (event.text.trim())
                      void publish({ ...base, messageId, message: event.text.slice(0, 12000) })
                  } else if (
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
                    const text = publicToolText.trim()
                      ? publicToolText
                      : getAssistantToolItemCopy(toolName, 'running', event.input)
                          .detail.map((segment) => segment.text)
                          .join('')
                    const actionMessageId = publicToolText.trim() ? messageId : event.toolCallId
                    actions.set(event.toolCallId, { text, messageId: actionMessageId })
                    void publish({
                      ...base,
                      messageId: actionMessageId,
                      action: {
                        id: event.toolCallId,
                        toolName: event.toolName,
                        text,
                        status: 'running'
                      }
                    })
                  } else if (event.type === 'tool_call_result') {
                    void publish({
                      ...base,
                      messageId: actions.get(event.toolCallId)?.messageId,
                      action: {
                        id: event.toolCallId,
                        toolName: event.toolName,
                        text: actions.get(event.toolCallId)?.text || '',
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
                        ownerRunId: payload.ownerRunId || payload.runId,
                        agentId: agent.agentId,
                        parentToolCallId: toolCallId
                      })
                  : undefined
              }
            )
            finished = true
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
                (output.status === 'failed'
                  ? [output.error, output.failureRawMessage].filter(Boolean).join('：') ||
                    '未知错误'
                  : output.finalDeliveryMarkdown || output.error || '未知错误')
              ).slice(0, 12000),
              artifacts: output.finalArtifacts
            }
            await publish(update)
            return update
          } catch (error) {
            finished = true
            const update: SubagentUpdate = {
              ...base,
              status: controller.signal.aborted || deps.isCancelled() ? 'cancelled' : 'failed',
              result: error instanceof Error ? error.message : String(error ?? '')
            }
            await publish(update)
            return update
          } finally {
            stream({ streaming: false })
            try {
              await updates
            } finally {
              deps.abortSignal?.removeEventListener('abort', cancel)
            }
          }
        })
      })
    )
    return results.map((result) => {
      if (result.status === 'rejected') throw result.reason
      return result.value
    })
  }
}
