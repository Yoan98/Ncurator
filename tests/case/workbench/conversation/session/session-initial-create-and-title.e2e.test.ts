import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  seedWorkbenchReadyState,
  sendWorkbenchMessage,
  waitForLatestAssistantFinalAnswer
} from '../../../../harness/e2e/workbench'

describe('workbench conversation e2e', () => {
  it('session-initial-create-and-title', async () => {
    await runE2ECase({
      caseId: 'session-initial-create-and-title',
      domain: 'workbench',
      suite: 'conversation',
      groups: ['session'],
      description: '首次进入 Workbench 自动创建初始会话，并由首条用户消息更新标题。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'seed-ready-state',
          message: '预置 Workbench 可发送所需的模型配置和工作区。',
          run: async () => {
            await seedWorkbenchReadyState(page)
          }
        })

        const initialSessionText =
          (await getWorkbenchLocator(page, workbenchSelectors.sessionsList).textContent()) || ''

        await runtime.step({
          name: 'send-first-message',
          message: '发送第一条用户消息，触发标题从默认状态更新为消息摘要。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-artifact-flow] 首条消息标题更新')
            await waitForLatestAssistantFinalAnswer(page)
          }
        })
        const firstTitleText =
          (await getWorkbenchLocator(page, workbenchSelectors.sessionsList).textContent()) || ''

        await runtime.step({
          name: 'send-second-message',
          message: '继续发送第二条消息，确认已有标题不会再次被自动改写。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-artifact-flow] 第二条消息不改标题')
            await waitForLatestAssistantFinalAnswer(page)
          }
        })
        const secondTitleText =
          (await getWorkbenchLocator(page, workbenchSelectors.sessionsList).textContent()) || ''

        return {
          initialSessionText,
          firstTitleText,
          secondTitleText
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.initialSessionText.includes('新对话'), {
          name: 'initial-session-is-created',
          message:
            '首次进入且没有历史会话时，界面应自动创建并进入“新对话”，对齐 WB-SESSION-001-AC1、WB-SESSION-001-AC2。',
          data: result
        })

        await runtime.assertThat(
          !result.firstTitleText.includes('新对话') &&
            result.firstTitleText.includes('[e2e:chat-artifact'),
          {
            name: 'first-message-updates-default-title',
            message:
              '第一条用户消息发送后，会话标题应从“新对话”切换为消息摘要，对齐 WB-SESSION-003-AC1。',
            data: result
          }
        )

        await runtime.assertThat(result.secondTitleText === result.firstTitleText, {
          name: 'later-messages-do-not-rewrite-title',
          message: '已有标题在后续消息发送时不应被再次自动改写，对齐 WB-SESSION-003-AC2。',
          data: result
        })
      }
    })
  }, WORKBENCH_E2E_TIMEOUT_MS)
})
