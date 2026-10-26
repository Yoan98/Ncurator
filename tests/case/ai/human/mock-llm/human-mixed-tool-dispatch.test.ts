import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType } from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('human-mixed-tool-dispatch', async () => {
    await runBackendCase({
      caseId: 'human-mixed-tool-dispatch',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证同一 assistant 消息中的 plan 与 hand 工具都由 dispatch 顺序执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.prepareEmbeddingModel()
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '先更新计划，再读取知识库目录。' },
                  toolCalls: [
                    {
                      name: 'update_plan',
                      args: {
                        plan: [
                          { title: '读取知识库目录', status: 'done' },
                          { title: '检查是否满足诉求', status: 'todo' }
                        ]
                      }
                    },
                    { name: 'kb_list_documents', args: {} }
                  ]
                }
              },
              ({ user }) => {
                if (!user.includes('读取知识库目录')) {
                  throw new Error('mixed dispatch did not preserve the updated plan')
                }
                return {
                  thought: { next: '两个工具都已返回，完成交付。' },
                  deliveryMarkdown: '混合工具分发完成。'
                }
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请更新计划并读取知识库目录。'
        })
        return { output, events: runtime.eventCollector.snapshot() }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        runtime.assertThat(
          result.output.status === 'completed' &&
            toolResults.map((event) => event.toolName).includes('update_plan') &&
            toolResults.map((event) => event.toolName).includes('kb_list_documents'),
          {
            name: 'mixed-tool-calls-are-fully-dispatched',
            message: '同一 assistant 消息中的 plan 和 hand 调用都必须执行并返回结果。',
            data: { toolResults }
          }
        )
      }
    })
  })

  it('human-mixed-tool-dispatch-after-invalid-plan', async () => {
    await runBackendCase({
      caseId: 'human-mixed-tool-dispatch-after-invalid-plan',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 plan 参数失败后不会丢弃后续 hand 调用。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.prepareEmbeddingModel()
        let fieldErrorSeen = false
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '发送错误计划后继续读取知识库目录。' },
                  toolCalls: [
                    {
                      name: 'update_plan',
                      args: { plan: [{ title: '保留原计划', status: 'doing' }] }
                    },
                    { name: 'update_plan', args: { plan: [{ title: '错误状态', status: 'bad' }] } },
                    { name: 'kb_list_documents', args: {} }
                  ]
                }
              },
              ({ user }) => {
                fieldErrorSeen =
                  user.includes('plan[0].status') &&
                  user.includes('doing') &&
                  user.includes('Invalid option')
                return { thought: { next: '失败结果和后续工具结果都已收到。' } }
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '验证错误计划不会中断后续工具。'
        })
        const messageLog = await runner.ctx.loadMessageLog()
        return {
          output,
          fieldErrorSeen,
          events: runtime.eventCollector.snapshot(),
          planUpdates: messageLog
            .map((record) => record.entry)
            .filter((entry) => entry.kind === 'annotation' && entry.eventType === 'plan_updated'),
          toolEntries: messageLog
            .map((record) => record.entry)
            .filter((entry) => entry.kind === 'tool')
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.fieldErrorSeen &&
            result.planUpdates.length === 1 &&
            result.toolEntries.some(
              (entry) =>
                entry.toolName === 'update_plan' &&
                entry.ok === false &&
                entry.content.includes('plan[0].status') &&
                result.events.some(
                  (event) =>
                    event.type === 'tool_call_result' &&
                    event.toolCallId === entry.toolCallId &&
                    entry.error === event.error
                )
            ) &&
            result.toolEntries.some(
              (entry) => entry.toolName === 'kb_list_documents' && entry.ok === true
            ),
          {
            name: 'invalid-plan-does-not-drop-later-tool-calls',
            message: '错误 plan 必须返回失败结果，并继续执行后续 hand 调用。',
            data: { toolEntries: result.toolEntries }
          }
        )
      }
    })
  })
})
