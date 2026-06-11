import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
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
                  skillIds: ['docx-read'],
                  summary: '先学习 docx-read'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '读取当前工作区路径'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成基础链路验证。'
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
          toolResults.some((event) => event.toolName === 'terminal_run') &&
            result.output.deliveryMarkdown.includes('human 主链路验证'),
          {
            name: 'human-mainline-completes-with-real-tool-and-real-mouth',
            message: 'mock-llm smoke case 应完成真实工具调用，并通过真实 mouth 收束为最终交付。',
            data: {
              toolResults: toolResults.map((event) => event.toolName),
              deliveryMarkdown: result.output.deliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          result.mouthPrompt.includes('<delivery_guidance>') &&
            result.mouthPrompt.includes('none'),
          {
            name: 'human-mainline-keeps-empty-delivery-guidance-when-no-hand-guidance',
            message: '当 hand 未产出 guidance 时，mouth prompt 的 delivery_guidance 区块应保持 none。',
            data: {
              mouthPrompt: result.mouthPrompt
            }
          }
        )
      }
    })
  })
})
