import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
  it('context-evidence-reuse', async () => {
    await runBackendCase({
      caseId: 'context-evidence-reuse',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证真实 context human 产出的可复用证据会被带入后续 director 计划 prompt。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let plannerSeesContextEvidence = false
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'need_context',
                  reason: '先补充上下文。'
                }
              },
              {
                output: {
                  mode: 'to_plan',
                  reason: '上下文已经足够，可以规划任务。'
                }
              }
            ],
            'director.plan': [
              ({ user }) => {
                plannerSeesContextEvidence = user.includes('Alice owns the risk')
                return {
                  tasks: [
                    {
                      id: 'task-1',
                      title: 'Reuse evidence',
                      userInput: '请继续使用已有 evidence 推进。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成上下文补充。',
                  reason: '先产出可复用 context note。',
                  expectedOutcome: '把 reusable evidence 交回 director。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'task 已完成。',
                  reason: '计划任务不需要额外动作。',
                  expectedOutcome: '返回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '综合输出完成。',
                  reason: '计划任务已经完成。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已完成上下文补充。',
                  deliveryMarkdown:
                    '# 上下文补充结果\n\n## 本轮结论\n已补充当前上下文。\n\n## 可复用证据\n- Alice owns the risk\n\n## 当前边界\n- 暂无其他限制。\n\n## 未决项\n无\n\n## 建议补充方向\n- 可直接规划后续任务。'
                }
              },
              {
                output: {
                  summary: 'task 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask 已完成。\n\n## 已确认信息\n- 已复用 context evidence。\n\n## 关键证据\n- Alice owns the risk\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可直接综合。\n\n## 建议下一步\n- 进入 synthesis。'
                }
              },
              {
                output: {
                  summary: '综合输出完成。',
                  deliveryMarkdown: '# Final Answer\n\n已复用 context evidence 完成任务。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请先补充上下文，再规划任务。'
        })

        return {
          state,
          plannerSeesContextEvidence
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.status === 'completed' && result.plannerSeesContextEvidence,
          {
            name: 'director-plan-prompt-reuses-context-human-evidence',
            message: 'context human 产出的 reusable evidence 应进入后续 director plan prompt。',
            data: {
              plannerSeesContextEvidence: result.plannerSeesContextEvidence,
              contextEvidence: result.state.contextEvidence
            }
          }
        )
      }
    })
  })
})
