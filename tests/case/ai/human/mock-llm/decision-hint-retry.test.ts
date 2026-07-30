import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('decision-hint-retry', async () => {
    await runBackendCase({
      caseId: 'decision-hint-retry',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证 duplicate learning 触发真实 decision_hint 后，graph 仍能回到 brain 并继续完成任务。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '第一次学习 docx-read'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '重复学习 docx-read'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '回到 brain 后执行真实工具'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'decision_hint 回退后链路恢复正常。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'decision_hint 回退后链路恢复正常。',
                  deliveryMarkdown: '# Watch Hint\n\n已验证 duplicate learning 后仍可继续执行。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请故意触发一次 decision_hint，然后继续完成任务。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output.status === 'completed' &&
            decisionHints.some(
              (event) =>
                event.source === 'learning' &&
                event.code === 'learning_no_effect' &&
                Array.isArray(event.detail?.duplicateSkillIds) &&
                event.detail.duplicateSkillIds.includes('docx-read')
            ) &&
            toolResults.some((event) => event.toolName === 'terminal_run'),
          {
            name: 'duplicate-learning-decision-hint-recovers',
            message:
              'duplicate learning 应由真实 learning node 产出 decision_hint，并在之后继续完成工具调用。',
            data: {
              decisionHints,
              toolResults: toolResults.map((event) => ({
                toolName: event.toolName,
                ok: event.ok,
                code: event.code
              }))
            }
          }
        )
      }
    })
  })
})
