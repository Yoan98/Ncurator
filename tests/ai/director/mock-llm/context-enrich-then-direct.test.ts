import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
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
})
