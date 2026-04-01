import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
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
