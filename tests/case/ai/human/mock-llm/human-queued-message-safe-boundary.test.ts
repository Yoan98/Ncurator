import { describe, it } from 'vitest'
import type { BaseMessage } from '@langchain/core/messages'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision, filterAiRunEventsByType } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('human-queued-message-safe-boundary', async () => {
    await runBackendCase({
      caseId: 'human-queued-message-safe-boundary',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证追加消息在真实工具结果写入后使 human graph 安全让出，并在续接时排在历史工具结果之后。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let hasQueuedMessage = false
        let queueSubmissionStarted = false
        let toolResultRecorded = false
        let firstBrainCallCount = 0
        let firstBrainMessages: BaseMessage[] | null = null
        const countFirstBrainCalls: NonNullable<AiRunDeps['chatToolsWrapper']> =
          (realChatTools) => async (request) => {
            if (request.caller === 'human.brain') firstBrainCallCount += 1
            return await realChatTools(request)
          }
        const firstRunner = createHumanTestRunner(runtime, {
          runId: `${runtime.runId}-queue-first`,
          partnerId: 'queued-message-partner',
          hasPendingUserMessages: () => hasQueuedMessage,
          waitForPendingUserMessageSubmissions: async () => {
            if (!queueSubmissionStarted || hasQueuedMessage) return
            await new Promise<void>((resolve) => setTimeout(resolve, 10))
            hasQueuedMessage = true
          },
          chatToolsWrapper: countFirstBrainCalls,
          observeEvent: (event) => {
            if (event.type === 'tool_call_result') toolResultRecorded = true
            if (
              event.type === 'context_budget_evaluated' &&
              event.decision === 'continue' &&
              toolResultRecorded
            ) {
              // Simulate a send arriving after context_budget checked the queue,
              // while the pending-message validation is still in flight.
              queueSubmissionStarted = true
            }
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'kb_list_documents',
                  args: {},
                  summary: '读取当前资料目录'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '如果走到这里，安全交接没有生效。',
                  deliveryMarkdown: '本句不应在追加消息交接前交付。'
                })
              }
            ]
          }
        })
        const firstOutput = await firstRunner.run({
          taskId: `${runtime.taskId}-queue-first`,
          userInput: '请读取当前资料目录，再告诉我有哪些文件。'
        })
        const firstLog = await firstRunner.ctx.loadMessageLog()

        const captureSecondBrain: NonNullable<AiRunDeps['chatToolsWrapper']> =
          (realChatTools) => async (request) => {
            if (request.caller === 'human.brain' && !firstBrainMessages) {
              firstBrainMessages = [...request.messages]
            }
            return await realChatTools(request)
          }
        const secondRunner = createHumanTestRunner(runtime, {
          runId: `${runtime.runId}-queue-second`,
          partnerId: 'queued-message-partner',
          chatToolsWrapper: captureSecondBrain,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '已在工具结果之后读取追加消息并完成交付。',
                  deliveryMarkdown: '已继续处理追加消息。'
                })
              }
            ]
          }
        })
        const secondOutput = await secondRunner.run({
          taskId: `${runtime.taskId}-queue-second`,
          userInput: '请结合刚才的目录结果继续。'
        })
        const secondLastMessage = firstBrainMessages?.at(-1)
        const firstToolResultIndex = firstBrainMessages?.findIndex(
          (message) => message.getType() === 'tool'
        )
        const secondUserMessageIndex = firstBrainMessages?.findIndex(
          (message, index) =>
            index > (firstToolResultIndex ?? -1) &&
            message.getType() === 'human' &&
            typeof message.content === 'string' &&
            message.content.includes('请结合刚才的目录结果继续。')
        )
        return {
          firstOutput,
          secondOutput,
          firstLog,
          firstEvents: runtime.eventCollector.snapshot(),
          firstBrainCallCount,
          firstToolResultIndex,
          secondUserMessageIndex,
          lastMessageType: secondLastMessage?.getType()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.firstEvents, 'tool_call_result')
        const toolLogEntries = result.firstLog.filter((record) => record.entry.kind === 'tool')
        runtime.assertThat(
            result.firstOutput.status === 'yielded' &&
            result.firstBrainCallCount === 1 &&
            toolResults.some((event) => event.toolName === 'kb_list_documents') &&
            toolLogEntries.some(
              (record) =>
                record.entry.kind === 'tool' && record.entry.toolName === 'kb_list_documents'
            ) &&
            result.secondOutput.status === 'completed' &&
            result.firstToolResultIndex !== undefined &&
            result.secondUserMessageIndex !== undefined &&
            result.firstToolResultIndex < result.secondUserMessageIndex &&
            result.lastMessageType === 'human',
          {
            name: 'queued-message-yields-after-tool-result',
            message: '安全交接必须等真实工具结果写入后发生，续接消息再按顺序追加到历史上下文末尾。',
            data: {
              firstOutput: result.firstOutput,
              firstBrainCallCount: result.firstBrainCallCount,
              secondOutput: result.secondOutput,
              toolResults,
              toolLogEntries: toolLogEntries.map((record) => record.entry),
              firstToolResultIndex: result.firstToolResultIndex,
              secondUserMessageIndex: result.secondUserMessageIndex,
              lastMessageType: result.lastMessageType
            }
          }
        )
      }
    })
  })
})
