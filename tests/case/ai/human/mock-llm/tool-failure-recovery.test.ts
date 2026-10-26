import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision, filterAiRunEventsByType } from '../testUtils'

const isWindows = process.platform === 'win32'

describe('ai human mock-llm backend', () => {
  it('tool-failure-recovery', async () => {
    await runBackendCase({
      caseId: 'tool-failure-recovery',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证校验拒绝即时显示失败过程，且混合调用中的真实工具失败不阻断最终交付。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const validationFeedbackSeen: boolean[] = []
        let eventsBeforeDelivery = runtime.eventCollector.snapshot()
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'web_search',
                  args: { query: '非正常户解除 办理事项 官方依据' },
                  summary: '检索官方来源'
                })
              },
              ({ user }) => {
                validationFeedbackSeen.push(user.includes('Invalid arguments for web_search.'))
                return {
                  thought: { next: '继续检索并执行一个会失败的安全指令' },
                  toolCalls: [
                    { name: 'web_search', args: { query: '参数失败后的第二次检索' } },
                    {
                      name: 'terminal_run',
                      args: {
                        command: isWindows
                          ? 'Get-Content -LiteralPath definitely-missing-file.txt'
                          : 'cat definitely-missing-file.txt',
                        commandExplanation: '读取不存在的文件以验证失败恢复'
                      }
                    }
                  ]
                }
              },
              ({ user }) => {
                validationFeedbackSeen.push(
                  user.includes('Invalid arguments for web_search.') &&
                    user.includes('definitely-missing-file.txt')
                )
                eventsBeforeDelivery = runtime.eventCollector.snapshot()
                return buildCompleteTaskDecision({
                  summary: '工具失败已被识别并吸收。',
                  deliveryMarkdown: '# Failure Recovery\n\n已确认命令失败，并在最终结果中说明限制。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请执行一次会失败的工具调用，然后继续输出结果。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          eventsBeforeDelivery,
          validationFeedbackSeen,
          messageLog: await runner.ctx.loadMessageLog()
        }
      },
      assert: async (result, runtime) => {
        const rejectedCalls = result.messageLog
          .flatMap(({ entry }) => (entry.kind === 'assistant' ? (entry.toolCalls ?? []) : []))
          .filter((call) => call.name === 'web_search')
        const startedGroups = filterAiRunEventsByType(
          result.eventsBeforeDelivery,
          'assistant_process_group_started'
        )
        const startedItems = filterAiRunEventsByType(
          result.eventsBeforeDelivery,
          'assistant_process_item_started'
        )
        const failedItems = filterAiRunEventsByType(
          result.eventsBeforeDelivery,
          'assistant_process_item_failed'
        )
        const failedGroups = filterAiRunEventsByType(
          result.eventsBeforeDelivery,
          'assistant_process_group_failed'
        )
        const executedCalls = filterAiRunEventsByType(result.events, 'tool_call_started')
        runtime.assertThat(
          rejectedCalls.length === 2 &&
            result.validationFeedbackSeen.length === 2 &&
            result.validationFeedbackSeen.every(Boolean) &&
            rejectedCalls.every((call) => {
              const groups = startedGroups.filter((event) =>
                event.groupId.endsWith(`:tool:${call.id}`)
              )
              const items = startedItems.filter((event) => event.itemId === call.id)
              const group = groups[0]
              const item = items[0]
              return (
                groups.length === 1 &&
                items.length === 1 &&
                group?.display.kind === 'tool' &&
                item?.display.kind === 'tool' &&
                group.display.toolName === call.name &&
                JSON.stringify(group.display.input) === JSON.stringify(call.args) &&
                JSON.stringify(item.display.input) === JSON.stringify(call.args) &&
                failedItems.filter((event) => event.itemId === call.id).length === 1 &&
                failedGroups.filter((event) => event.groupId === group.groupId).length === 1 &&
                result.messageLog.some(
                  ({ entry }) =>
                    entry.kind === 'tool' &&
                    entry.toolCallId === call.id &&
                    entry.toolName === call.name &&
                    entry.ok === false
                ) &&
                !executedCalls.some((event) => event.toolCallId === call.id)
              )
            }),
          {
            name: 'validation-rejections-have-live-failed-activity',
            message:
              '全部拒绝和混合调用中的校验失败必须即时发出失败过程，与日志使用同一 ID 和入参，且不执行无效工具。',
            data: {
              rejectedCalls,
              startedGroups,
              failedGroups,
              validationFeedbackSeen: result.validationFeedbackSeen
            }
          }
        )
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const failedResult = toolResults.find((event) => event.toolName === 'terminal_run')
        const terminalData = failedResult?.result?.data
        const status =
          typeof terminalData === 'object' &&
          terminalData !== null &&
          !Array.isArray(terminalData) &&
          typeof terminalData.status === 'string'
            ? terminalData.status
            : null

        runtime.assertThat(
          result.output.status === 'completed' &&
            Boolean(failedResult) &&
            failedResult?.result?.ok === true &&
            status === 'failed',
          {
            name: 'human-recovers-from-real-tool-failure',
            message: '终端命令非零退出后，human 仍应识别失败事实并继续完成最终交付。',
            data: failedResult
          }
        )
      }
    })
  })
})
