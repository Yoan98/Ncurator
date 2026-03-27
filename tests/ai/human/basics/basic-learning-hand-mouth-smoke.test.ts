import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human basics backend', () => {
  it('basic-learning-hand-mouth-smoke', async () => {
    await runBackendCase({
      caseId: 'basic-learning-hand-mouth-smoke',
      domain: 'ai',
      suite: 'human',
      groups: ['basics'],
      description: '验证最基础的 brain -> learning -> hand -> mouth 链路能稳定走通。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const delivery = createCapturingDeliveryOverride({
          buildMarkdown: '# Smoke Delivery\n\n已完成基础 human 主链路验证。'
        })
        const runner = createHumanTestRunner(runtime, {
          humanReasonOverrides: [
            {
              output: {
                action: 'load_skill',
                skillId: 'workspace-cli',
                rationale: '先学习 terminal 相关 skill，保证 hand 可执行具体工具。',
                publicNarrative: '先学习 workspace-cli'
              }
            },
            {
              output: {
                action: 'invoke_tool',
                toolName: 'terminal_run_command',
                args: {
                  command: 'pwd'
                },
                rationale: '执行一次稳定的只读 terminal 工具调用，验证 hand 主链路。',
                publicNarrative: '读取当前工作区路径'
              }
            },
            {
              output: {
                action: 'complete_task',
                summary: '已完成基础链路验证。',
                rationale: '核心部位都已走通，可以进入最终交付。',
                publicNarrative: '整理最终交付'
              }
            }
          ],
          humanDeliveryOverride: delivery.override
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请学习一个 skill，调用一次工具，然后给出最终结果。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          capturedState: delivery.getCapturedState()
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
            message: '基础 smoke case 应显式走过 brain、learning、hand、mouth 四个部位。',
            data: {
              stages: Array.from(stageSet),
              steps: summarizeHumanSteps(result.events)
            }
          }
        )

        runtime.assertThat(
          toolResults.some((event) => event.toolName === 'terminal_run_command') &&
            deliveryEvents.length === 1 &&
            result.capturedState?.brainMemory.outside.learnedSkillIds.includes('workspace-cli') ===
              true,
          {
            name: 'human-mainline-completes-with-tool-and-delivery',
            message: '基础 smoke case 应完成一次真实 hand 工具调用，并最终稳定收束为 completed。',
            data: {
              toolResults: toolResults.map((event) => event.toolName),
              deliveryCount: deliveryEvents.length,
              learnedSkillIds: result.capturedState?.brainMemory.outside.learnedSkillIds || []
            }
          }
        )
      }
    })
  })
})
