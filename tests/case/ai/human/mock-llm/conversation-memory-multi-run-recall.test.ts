import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision } from '../testUtils'

const SESSION_ID = 'conversation-memory-multi-run-session'

describe('ai human mock-llm backend', () => {
  it('conversation-memory-multi-run-recall', async () => {
    await runBackendCase({
      caseId: 'conversation-memory-multi-run-recall',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证同一 session 下之前 run 的用户消息与助手最终回答会作为真实消息带入下一次 brain prompt。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const run1 = createHumanTestRunner(runtime, {
          partnerId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '先准备发布清单。',
                  deliveryMarkdown: '当前已确认主线是发布准备，但还缺少回滚负责人。'
                })
              }
            ]
          }
        })
        await run1.run({ taskId: 'conversation-recall-run-1', userInput: '我们先准备发布清单。' })

        const run2 = createHumanTestRunner(runtime, {
          partnerId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '汇报负责人候选。',
                  deliveryMarkdown: '负责人候选改成了 Bob，但审批仍未完成，还发现上线窗口冲突待确认。'
                })
              }
            ]
          }
        })
        await run2.run({
          taskId: 'conversation-recall-run-2',
          userInput: '上线窗口和审批情况有更新吗？'
        })

        let promptSeesPriorFacts = false
        const run3 = createHumanTestRunner(runtime, {
          partnerId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              ({ user }) => {
                promptSeesPriorFacts =
                  user.includes('Bob') &&
                  user.includes('上线窗口冲突待确认') &&
                  user.includes('还缺少回滚负责人')
                return buildCompleteTaskDecision({
                  summary: '基于前面的进展，汇报当前状态和下一步。',
                  deliveryMarkdown:
                    '当前负责人候选是 Bob，审批仍未完成，且上线窗口冲突待确认。下一步先确认窗口，再推进审批。'
                })
              }
            ]
          }
        })
        const output = await run3.run({
          taskId: 'conversation-recall-run-3',
          userInput: '基于前面的进展，告诉我当前状态和下一步。'
        })

        return { output, promptSeesPriorFacts }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.promptSeesPriorFacts &&
            result.output.deliveryMarkdown.includes('Bob') &&
            result.output.deliveryMarkdown.includes('上线窗口冲突待确认') &&
            result.output.deliveryMarkdown.includes('先确认窗口'),
          {
            name: 'conversation-memory-multi-run-summary-and-recall-stay-consistent',
            message:
              '之前 run 的用户消息与助手最终回答应通过消息转录进入下一次 brain prompt，并在最终交付中正确带入。',
            data: result
          }
        )
      }
    })
  })
})
