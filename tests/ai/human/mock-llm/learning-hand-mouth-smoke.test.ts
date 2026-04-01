import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('learning-hand-mouth-smoke', async () => {
    await runBackendCase({
      caseId: 'learning-hand-mouth-smoke',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实 human graph 在 mock-llm 模式下能稳定走通 brain -> learning -> hand -> mouth 主链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let mouthPrompt = ''
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '先学习 workspace-cli',
                  reason: '需要先加载 terminal skill 才能进行真实工具调用。',
                  expectedOutcome: '获得 terminal 工具后继续推进。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'pwd'
                  },
                  summary: '读取当前工作区路径',
                  reason: '用一次只读命令验证真实 hand 执行链路。',
                  expectedOutcome: '拿到当前工作区路径后结束任务。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成基础链路验证。',
                  reason: '核心链路已经真实走通，可以进入最终交付。',
                  expectedOutcome: '输出稳定的最终结果。'
                })
              }
            ],
            'human.mouth': [
              ({ user }) => {
                mouthPrompt = user
                return {
                  summary: '已完成基础链路验证。',
                  deliveryMarkdown: '# Smoke Delivery\n\n已完成基础 human 主链路验证。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请学习一个 skill，调用一次工具，然后给出最终结果。'
        })

        return {
          output,
          mouthPrompt,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const deliveryEvents = filterAiRunEventsByType(result.events, 'task_delivery_ready')
        const stageSet = new Set(humanSteps.map((event) => event.stage))

        runtime.assertThat(
          result.output.status === 'completed' &&
            stageSet.has('human_brain') &&
            stageSet.has('human_learning') &&
            stageSet.has('human_hand') &&
            stageSet.has('human_mouth'),
          {
            name: 'human-mainline-visits-all-four-parts',
            message: 'mock-llm smoke case 应显式走过 brain、learning、hand、mouth 四个部位。',
            data: {
              stages: Array.from(stageSet),
              steps: summarizeHumanSteps(result.events)
            }
          }
        )

        runtime.assertThat(
          toolResults.some((event) => event.toolName === 'terminal_run_command') &&
            deliveryEvents.length === 1,
          {
            name: 'human-mainline-completes-with-real-tool-and-real-mouth',
            message: 'mock-llm smoke case 应完成真实工具调用，并通过真实 mouth 收束为最终交付。',
            data: {
              toolResults: toolResults.map((event) => event.toolName),
              deliveryCount: deliveryEvents.length
            }
          }
        )
      }
    })
  })
})
