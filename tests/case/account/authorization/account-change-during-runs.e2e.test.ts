import { expect, it } from 'vitest'
import {
  accountNetwork,
  armAccountFault,
  available,
  labels,
  menuItem,
  newTestEmail,
  openAccountMenu,
  readDesktopUserNo,
  releaseModelResult,
  withAccountFixture
} from '../../../harness/e2e/account'
import { dismissNativeConfirmation, openNativeConfirmation } from '../../../harness/e2e/nativeConfirm'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  sendWorkbenchMessage,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

it('account-change-during-runs', async () => {
  await withAccountFixture(async (setup, service) => {
    const model = service.model
    if (!model?.visionLive) throw new Error('Configure the isolated managed model live profile')
    await runE2ECase({
      ...setup,
      caseId: 'account-change-during-runs',
      domain: 'account',
      suite: 'authorization',
      description: '真实桌面退出确认和换号不会迁移已受理的馆长调用及其费用。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'live',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const originalEmail = newTestEmail('original-run')
        let browser = await service.browserPage()
        await service.authorize(runtime, browser, originalEmail)
        browser = await service.continueInBrowser(browser)
        const originalUser = await service.userNumber(browser)
        await service.recharge(browser)
        await createPartnerThroughWorkbenchUi(page, '换号后馆长费用归属')
        await dismissWorkbenchLlmConfigMissingNotification(page)
        await getWorkbenchLocator(page, workbenchSelectors.modelSelect).getByRole('button').click()
        await page
          .getByTestId(`${workbenchSelectors.modelSelectManagedOptionPrefix}-${model.id}`)
          .click()

        await armAccountFault(runtime, 'holdModelResult')
        try {
          await sendWorkbenchMessage(page, '只回复 READY，不调用工具。')
          const started = await waitForWorkbenchAiEvent(runtime, {
            name: 'managed-run-before-account-change',
            matches: (event) => event.type === 'run_started'
          })
          await expect
            .poll(async () => (await accountNetwork(runtime)).heldModelRequestId ?? '', {
              timeout: 15_000
            })
            .toMatch(/^[\da-f-]{36}$/u)
          const original = (await service.evidence(originalEmail)).calls
          expect(original).toHaveLength(1)
          expect(original[0]).toMatchObject({
            requestId: (await accountNetwork(runtime)).heldModelRequestId,
            executionStatus: 'completed',
            feeDecision: 'charge'
          })
          expect(BigInt(original[0].paidAmount)).toBeGreaterThan(0n)

          const logout = async (choice: 'cancel' | 'confirm') => {
            await openAccountMenu(page)
            const title = '退出当前桌面'
            const dialog = await openNativeConfirmation(runtime, menuItem(page, labels.signOut), title)
            await dialog.getByText('退出将停止这些任务', { exact: true }).waitFor()
            await dismissNativeConfirmation(dialog, choice, title)
          }
          await logout('cancel')
          expect(await readDesktopUserNo(page)).toBe(originalUser)
          expect((await accountNetwork(runtime)).heldModelRequestId).toBe(original[0].requestId)
          await page.getByRole('button', { name: '停止本次运行', exact: true }).waitFor()

          await logout('confirm')
          await waitForWorkbenchAiEvent(runtime, {
            name: 'original-managed-run-stopped-on-logout',
            matches: (event) => event.type === 'run_cancelled' && event.runId === started.runId
          })
          const next = await service.browserPage()
          const nextEmail = newTestEmail('next-run')
          await service.authorize(runtime, next, nextEmail)
          const nextUser = await service.userNumber(next)
          expect(nextUser).not.toBe(originalUser)
          await releaseModelResult(runtime)
          await expect
            .poll(async () => (await accountNetwork(runtime)).heldModelRequestId)
            .toBeUndefined()
          await openAccountMenu(page)
          await expect.poll(() => available(page).innerText()).toBe('¥0.00')
          expect(await readDesktopUserNo(page)).toBe(nextUser)
          expect((await service.evidence(nextEmail)).calls).toHaveLength(0)
          const originalAfter = await service.evidence(originalEmail)
          expect(originalAfter.calls).toEqual(original)
          expect(
            originalAfter.sessions.filter(
              (session) => session.clientType === 'desktop' && !session.revokedReason
            )
          ).toHaveLength(0)
          expect((await accountNetwork(runtime)).modelPosts).toEqual([original[0].requestId])
          return { originalCharges: originalAfter.calls.length, nextCharges: 0 }
        } finally {
          await releaseModelResult(runtime)
        }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.originalCharges === 1 && result.nextCharges === 0, {
          name: 'managed-account-change-preserves-owner-and-charge',
          message: '已受理馆长调用只归原账号，迟到结果不会串号',
          data: result
        })
    })
  })
}, 155_000)
