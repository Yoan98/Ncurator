import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision, filterAiRunEventsByType } from '../testUtils'

describe('ai human mock-llm utility backend', () => {
  it('human-utility-wait-and-takeover-resume', async () => {
    await runBackendCase({
      caseId: 'human-utility-wait-and-takeover-resume',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 短等待、请求用户接管并确认后继续完成。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const output = await createHumanTestRunner(runtime, {
          allowedToolNames: ['wait_time', 'wait_for_user_takeover'],
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'wait_time',
                  args: { seconds: 0.05 },
                  summary: '短暂等待页面稳定'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'wait_for_user_takeover',
                  args: { message: '请完成登录后确认' },
                  summary: '请求用户接管'
                })
              },
              { output: buildCompleteTaskDecision({ summary: '用户确认后任务已继续完成。' }) }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '用户确认后任务已继续完成。',
                  deliveryMarkdown: '登录确认后已继续完成任务。'
                }
              }
            ]
          }
        }).run({
          taskId: runtime.taskId,
          userInput: '等待页面稳定，需要时让我接管登录，确认后继续。'
        })
        return { output, events: runtime.eventCollector.snapshot() }
      },
      assert: async (result, runtime) => {
        const results = filterAiRunEventsByType(result.events, 'tool_call_result')
        const required = filterAiRunEventsByType(result.events, 'user_takeover_required')
        const confirmed = filterAiRunEventsByType(result.events, 'user_takeover_confirmed')
        runtime.assertThat(
          result.output.status === 'completed' &&
            results.map((event) => event.toolName).join(',') ===
              'wait_time,wait_for_user_takeover' &&
            required.length === 1 &&
            confirmed.length === 1 &&
            required[0]?.requestId === confirmed[0]?.requestId,
          {
            name: 'human-utility-wait-takeover-resume',
            message: 'human 应等待、发出一次接管请求，并在同一请求确认后继续完成。',
            data: result
          }
        )
      }
    })
  })
})
