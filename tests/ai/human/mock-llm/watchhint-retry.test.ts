import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('watchhint-retry', async () => {
    await runBackendCase({
      caseId: 'watchhint-retry',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 duplicate learning 触发真实 watch_hint 后，graph 仍能回到 brain 并继续完成任务。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '第一次学习 workspace-cli',
                  reason: '需要 terminal skill。',
                  expectedOutcome: '加载 tool 后继续执行。'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '重复学习 workspace-cli',
                  reason: '故意触发 learning watch_hint。',
                  expectedOutcome: '验证 watch_hint 后能继续回到 brain。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'workspace_run_command',
                  args: {
                    command: 'pwd'
                  },
                  summary: '回到 brain 后执行真实工具',
                  reason: '确认 watch_hint 不会阻断真实链路。',
                  expectedOutcome: '拿到工作区路径并结束。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'watch_hint 回退后链路恢复正常。',
                  reason: 'duplicate learning 已被真实 learning node 消化。',
                  expectedOutcome: '结束任务。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'watch_hint 回退后链路恢复正常。',
                  deliveryMarkdown: '# Watch Hint\n\n已验证 duplicate learning 后仍可继续执行。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请故意触发一次 watch_hint，然后继续完成任务。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const watchHints = filterAiRunEventsByType(result.events, 'watch_hint')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          result.output.status === 'completed' &&
            watchHints.some(
              (event) =>
                event.source === 'learning' &&
                event.code === 'learning_no_effect' &&
                Array.isArray(event.detail?.duplicateSkillIds) &&
                event.detail.duplicateSkillIds.includes('workspace-cli')
            ) &&
            toolResults.some((event) => event.toolName === 'workspace_run_command'),
          {
            name: 'duplicate-learning-watchhint-recovers',
            message: 'duplicate learning 应由真实 learning node 产出 watch_hint，并在之后继续完成工具调用。',
            data: {
              watchHints,
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
