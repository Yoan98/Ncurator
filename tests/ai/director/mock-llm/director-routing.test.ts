import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterDirectorEventsByType, filterDirectorTaskEventsByStage } from '../testUtils'
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

  it('context-enrich-then-direct', async () => {
    await runBackendCase({
      caseId: 'context-enrich-then-direct',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 会先走真实 context human，再回到 intent 并进入 direct human。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'need_context',
                  reason: '先补充上下文范围。'
                }
              },
              {
                output: {
                  mode: 'direct_human',
                  reason: '上下文已经足够，可以直接交给 human。'
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '已补充当前上下文。',
                  reason: '当前任务只需要先整理上下文说明。',
                  expectedOutcome: '产出 context_note。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已根据上下文完成任务。',
                  reason: 'context human 已经补足关键信息。',
                  expectedOutcome: '输出最终答复。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已补充当前上下文。',
                  deliveryMarkdown:
                    '# 上下文补充结果\n\n## 本轮结论\n已补充当前上下文。\n\n## 可复用证据\n- 当前范围仅包含用户选中的资料。\n\n## 当前边界\n- 暂未执行额外工具。\n\n## 未决项\n无\n\n## 建议补充方向\n- 可直接进入任务执行。'
                }
              },
              {
                output: {
                  summary: '已根据上下文完成任务。',
                  deliveryMarkdown: '# Final Answer\n\n已基于补充上下文完成任务。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请先补充上下文，再直接完成任务。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.status === 'completed' &&
            result.state.contextRounds === 1 &&
            result.state.contextEvidence.includes('当前范围仅包含用户选中的资料。'),
          {
            name: 'director-can-loop-through-real-context-human',
            message: 'director 应先经过真实 context human，再回到 intent 并继续 direct human。',
            data: {
              contextRounds: result.state.contextRounds,
              contextEvidence: result.state.contextEvidence
            }
          }
        )
      }
    })
  })

  it('context-round-cap', async () => {
    await runBackendCase({
      caseId: 'context-round-cap',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 contextRounds 到达上限后，director 会直接转入计划阶段而不再重复 intent LLM 决策。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let intentCallCount = 0
        const runner = createDirectorTestRunner(
          runtime,
          {
            structuredOutputScript: {
              'director.intent': [
                () => {
                  intentCallCount += 1
                  return {
                    mode: 'need_context',
                    reason: '先补充一次上下文。'
                  }
                }
              ],
              'director.plan': [
                {
                  output: {
                    tasks: [
                      {
                        id: 'task-1',
                        title: 'Single Task',
                        userInput: '请直接完成剩余任务。'
                      }
                    ]
                  }
                }
              ],
              'human.brain': [
                {
                  output: buildCompleteTaskDecision({
                    summary: '已完成上下文补充。',
                    reason: '先输出一次 context note。',
                    expectedOutcome: '返回 director。'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: '子任务已完成。',
                    reason: '计划任务本身不需要额外动作。',
                    expectedOutcome: '交回 director。'
                  })
                },
                {
                  output: buildCompleteTaskDecision({
                    summary: '最终汇总完成。',
                    reason: '计划任务已经完成，可以综合输出。',
                    expectedOutcome: '完成 director run。'
                  })
                }
              ],
              'human.mouth': [
                {
                  output: {
                    summary: '已完成上下文补充。',
                    deliveryMarkdown:
                      '# 上下文补充结果\n\n## 本轮结论\n已完成上下文补充。\n\n## 可复用证据\n- 已达到上下文上限。\n\n## 当前边界\n- 不再继续追加 context round。\n\n## 未决项\n无\n\n## 建议补充方向\n- 转入计划阶段。'
                  }
                },
                {
                  output: {
                    summary: '子任务已完成。',
                    deliveryMarkdown:
                      '# 任务交接结果\n\n## 任务完成情况\n子任务已完成。\n\n## 已确认信息\n- 已达到 context 上限。\n\n## 关键证据\n- 当前可直接进入综合输出。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可直接综合。\n\n## 建议下一步\n- 进入 synthesis。'
                  }
                },
                {
                  output: {
                    summary: '最终汇总完成。',
                    deliveryMarkdown: '# Final Answer\n\n在达到 context 上限后已直接转入计划并完成。'
                  }
                }
              ]
            }
          },
          {
            maxContextRounds: 1
          }
        )

        const state = await runner.run({
          userInput: '请验证 context round cap。'
        })

        return {
          state,
          intentCallCount
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.status === 'completed' &&
            result.intentCallCount === 1 &&
            result.state.plan.length === 1,
          {
            name: 'director-stops-context-loop-at-cap',
            message: '达到 context 上限后，director 不应再次调用 intent LLM，而应直接转入计划阶段。',
            data: {
              intentCallCount: result.intentCallCount,
              plan: result.state.plan
            }
          }
        )
      }
    })
  })
})
