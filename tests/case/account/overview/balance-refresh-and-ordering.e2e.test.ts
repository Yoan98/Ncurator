import { expect, it } from 'vitest'
import {
  accountButton,
  accountPanel,
  available,
  labels,
  menuItem,
  newTestEmail,
  armAccountFault,
  accountNetwork,
  releaseWallet,
  walletReads,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { setWorkbenchInput, submitWorkbenchCurrentDraft } from '../../../harness/e2e/workbench'

it('balance-refresh-and-ordering', async () => {
  await withAccountFixture(async (setup, service) => {
    await runE2ECase({
      ...setup,
      caseId: 'balance-refresh-and-ordering',
      domain: 'account',
      suite: 'overview',
      description: '真实馆长结算、旧余额乱序与原请求查回不会重复消费或串号。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const menu = accountButton(page)
        await menu.click()
        await menuItem(page, labels.login).click()
        let web = await service.browserPage()
        const email = newTestEmail('ordering')
        await service.authorize(runtime, web, email)
        web = await service.continueInBrowser(web)
        await service.recharge(web)
        const refresh = accountPanel(page).getByRole('button', { name: labels.refresh })
        await refresh.click()
        await expect.poll(() => available(page).innerText()).toBe('¥5.00')
        const reads = await walletReads(runtime)
        await menu.click()
        await menuItem(page, labels.balance).click()
        expect(await walletReads(runtime)).toBe(reads)
        await armAccountFault(runtime, 'holdWallet')
        await refresh.click()
        await expect
          .poll(async () => (await accountNetwork(runtime)).heldWallet?.available)
          .toBe('500000000')
        await page.getByTestId('settings-back-row').click()
        await page.getByTestId('workbench-new-partner-button').click()
        await page.getByTestId('workbench-create-partner-name-input').fill('余额乱序测试')
        await page.getByTestId('workbench-create-partner-name-input').press('Enter')
        await page.getByTestId('workbench-create-partner-modal').waitFor({ state: 'hidden' })
        expect(service.model).toBeDefined()
        await page.getByTestId('workbench-model-select').getByRole('button').click()
        await page.getByTestId('workbench-model-managed-option-' + service.model!.id).click()
        const send = async (text: string) => {
          await setWorkbenchInput(page, text)
          await submitWorkbenchCurrentDraft(page)
        }
        await send('执行第一条隔离计量请求。')
        await expect
          .poll(async () => (await service.evidence(email)).calls.length, { timeout: 20_000 })
          .toBe(1)
        await expect
          .poll(async () => (await service.evidence(email)).calls[0].executionStatus)
          .toBe('completed')
        await menu.click()
        await menuItem(page, labels.balance).click()
        const precise = accountPanel(page).locator('details')
        await precise.locator('summary').click()
        await precise.getByText('4.999946 CNY', { exact: true }).waitFor()
        await releaseWallet(runtime)
        await expect.poll(async () => (await accountNetwork(runtime)).releasedWallets).toBe(1)
        await precise.getByText('4.999946 CNY', { exact: true }).waitFor()
        expect(await walletReads(runtime)).toBe(reads + 1)
        await page.getByTestId('settings-back-row').click()
        await armAccountFault(runtime, 'dropModelResult')
        await send('执行第二条隔离计量请求。')
        await expect
          .poll(async () => (await accountNetwork(runtime)).droppedResults, { timeout: 20_000 })
          .toBe(1)
        await expect
          .poll(async () => (await accountNetwork(runtime)).modelLookups.length)
          .toBeGreaterThan(0)
        await menu.click()
        await menuItem(page, labels.balance).click()
        const details = accountPanel(page).locator('details')
        await details.locator('summary').click()
        await details.getByText('4.999892 CNY', { exact: true }).waitFor()
        const network = await accountNetwork(runtime)
        expect(network.modelPosts).toHaveLength(2)
        expect(new Set(network.modelPosts).size).toBe(2)
        expect(network.modelLookups.every((id) => id === network.modelPosts[1])).toBe(true)
        const evidence = await service.evidence(email)
        expect(evidence.calls).toHaveLength(2)
        expect(evidence.calls.every((call) => call.paidAmount === '5400')).toBe(true)
        await armAccountFault(runtime, 'holdWallet')
        await refresh.click()
        await expect
          .poll(async () => (await accountNetwork(runtime)).heldWallet?.available)
          .toBe('499989200')
        await menu.click()
        await menuItem(page, labels.signOut).click()
        await accountPanel(page).getByText(labels.original).waitFor()
        await releaseWallet(runtime)
        await expect.poll(async () => (await accountNetwork(runtime)).releasedWallets).toBe(2)
        expect(await available(page).count()).toBe(0)
        await runtime.captureScreenshot({
          name: 'ordering-after-logout',
          message: '迟到余额不恢复退出的账号'
        })
        return { calls: evidence.calls.length, network }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.calls === 2, {
          name: 'settlement-ordering',
          message: '旧快照不覆盖真实结算，结果丢失按原请求查回且无重复消费',
          data: result
        })
    })
  })
}, 180_000)
