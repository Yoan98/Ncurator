import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  getWorkbenchPrefixLocator,
  seedWorkbenchReadyState,
  sendWorkbenchMessage,
  waitForLatestAssistantFinalAnswer,
  waitForLatestAssistantProcess
} from '../../../../harness/e2e/workbench'

describe('workbench run e2e', () => {
  it('ai-process-stream-and-final-answer', async () => {
    await runE2ECase({
      caseId: 'ai-process-stream-and-final-answer',
      domain: 'workbench',
      suite: 'run',
      groups: ['process'],
      description: '智能模式发送后展示过程流，并以最终 markdown 输出收口用户诉求。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'seed-ready-state',
          message: '预置 Workbench 智能模式可运行状态。',
          run: async () => {
            await seedWorkbenchReadyState(page)
          }
        })

        await runtime.step({
          name: 'send-ai-fixture',
          message: '发送 AI fixture 请求，等待过程流和最终回答。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-artifact-flow] 展示过程流并收口')
            await waitForLatestAssistantProcess(page)
            await waitForLatestAssistantFinalAnswer(page)
          }
        })

        const processText =
          (await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessPrefix
          ).last().textContent()) || ''
        const finalAnswerText =
          (await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantFinalAnswerPrefix
          ).last().textContent()) || ''
        const assistantTurnCount = await getWorkbenchPrefixLocator(
          page,
          workbenchSelectors.assistantTurnPrefix
        ).count()
        const processItemCount = await getWorkbenchPrefixLocator(
          page,
          workbenchSelectors.assistantProcessItemPrefix
        ).count()

        return {
          processText,
          finalAnswerText,
          assistantTurnCount,
          processItemCount
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.assistantTurnCount > 0 && result.processItemCount > 0, {
          name: 'assistant-process-stream-renders',
          message:
            '智能模式发送后应可见 assistant 过程流并逐步追加更新，对齐 WB-COMPOSER-003-AC1、WB-COMPOSER-003-AC2。',
          data: result
        })

        await runtime.assertThat(
          result.processText.trim().length > 0 &&
            !result.processText.includes('human_step') &&
            !result.processText.includes('tool_call_started') &&
            !result.processText.includes('tool_call_result'),
          {
            name: 'process-layer-uses-user-facing-language',
            message:
              '过程流应使用用户可理解的分层文案，不直接暴露内部事件名，对齐 WB-COMPOSER-003-AC6。',
            data: result
          }
        )

        await runtime.assertThat(result.finalAnswerText.includes('E2E fixture 已生成'), {
          name: 'final-answer-closes-the-task',
          message:
            '最终输出应位于过程流下方并围绕用户诉求收口，对齐 WB-COMPOSER-003-AC4、WB-CORE-006-AC1。',
          data: result
        })
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
