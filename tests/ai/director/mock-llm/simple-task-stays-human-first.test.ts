import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterDirectorTaskEventsByStage } from '../testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision
} from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
  it('simple-task-stays-human-first', async () => {
    await runBackendCase({
      caseId: 'simple-task-stays-human-first',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 在 mock-llm 模式下会通过真实 human-first 路径完成简单任务。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'direct_human',
                  reason: '当前任务简单，直接交给 human 执行。'
                }
              }
            ],
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli'],
                  summary: '学习 terminal skill',
                  reason: '需要执行一次真实只读命令。',
                  expectedOutcome: '拿到 terminal 工具。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'pwd'
                  },
                  summary: '读取工作区路径',
                  reason: '验证 director -> real human -> real tool 主链路。',
                  expectedOutcome: '拿到工作区路径后结束任务。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'direct human 已完成。',
                  reason: '核心链路已经真实走通。',
                  expectedOutcome: '交回 director 完成。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'direct human 已完成。',
                  deliveryMarkdown: '# Director Direct\n\n已通过 human-first 路径完成任务。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请直接完成一个简单任务。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const directTaskStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_direct_human_exec'
        )
        const directTaskCompletes = filterDirectorTaskEventsByStage(
          result.events,
          'task_completed',
          'director_direct_human_exec'
        )

        runtime.assertThat(
          result.state.status === 'completed' &&
            result.state.finalDeliveryMarkdown?.includes('human-first 路径') === true &&
            directTaskStarts.length === 1 &&
            directTaskCompletes.length === 1,
          {
            name: 'director-direct-route-uses-real-human-runner',
            message: 'simple task 应经由 director_direct_human_exec 真实派发 human 并完成。',
            data: {
              finalDeliveryMarkdown: result.state.finalDeliveryMarkdown,
              directTaskStarts,
              directTaskCompletes
            }
          }
        )
      }
    })
  })
})
