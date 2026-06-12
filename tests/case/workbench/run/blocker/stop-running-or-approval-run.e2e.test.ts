import { describe, it } from 'vitest'
import { chatSelectors, workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  getApprovalCard,
  getWorkbenchLocator,
  seedWorkbenchReadyState,
  sendWorkbenchMessage
} from '../../../../harness/e2e/workbench'
import { getSettingsLocator } from '../../../../harness/e2e/settings'

describe('workbench run e2e', () => {
  it('stop-running-or-approval-run', async () => {
    await runE2ECase({
      caseId: 'stop-running-or-approval-run',
      domain: 'workbench',
      suite: 'run',
      groups: ['blocker'],
      description: '运行中底部发送按钮切换为停止图标，并可释放审批等待中的 run。',
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
          name: 'trigger-approval-wait',
          message: '触发审批等待中的运行态。',
          run: async () => {
            await sendWorkbenchMessage(page, '[e2e:chat-approval] 审批等待时点击停止')
            await getApprovalCard(page).waitFor({ state: 'visible' })
          }
        })

        const stopButtonVisible = await getWorkbenchLocator(page, workbenchSelectors.sendButton)
          .filter({ has: page.locator('svg') })
          .isVisible()
          .catch(() => false)
        const stopButtonEnabled = await getWorkbenchLocator(page, workbenchSelectors.sendButton)
          .isEnabled()
          .catch(() => false)
        const independentCancelVisible = await getWorkbenchLocator(page, workbenchSelectors.cancelButton)
          .isVisible()
          .catch(() => false)

        await runtime.step({
          name: 'click-stop-while-approval-pending',
          message: '审批等待时点击底部停止图标。',
          run: async () => {
            if (!stopButtonEnabled) return
            await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
            await getSettingsLocator(page, chatSelectors.approvalBatchCard).waitFor({
              state: 'hidden'
            })
          }
        })

        const approvalCardStillVisible = await getApprovalCard(page).isVisible().catch(() => false)
        const bodyText = (await page.locator('body').textContent()) || ''

        return {
          stopButtonVisible,
          stopButtonEnabled,
          independentCancelVisible,
          approvalCardStillVisible,
          bodyText
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.stopButtonVisible && result.stopButtonEnabled && !result.independentCancelVisible,
          {
          name: 'running-uses-bottom-stop-button',
          message:
            '运行中发送按钮应切换为停止图标，且页面不再显示独立取消按钮，对齐 WB-COMPOSER-006-AC1。',
          data: result
          }
        )

        await runtime.assertThat(
          !result.approvalCardStillVisible && result.bodyText.includes('取消'),
          {
            name: 'stop-releases-approval-wait',
            message:
              '当前运行卡在审批等待时，点击停止图标也应结束本次 run，而不是继续等待审批提交，对齐 WB-COMPOSER-006-AC2、WB-COMPOSER-006-AC3。',
            data: result
          }
        )
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
