import { expect, it } from 'vitest'
import {
  accountButton,
  accountPanel,
  available,
  labels,
  mask,
  menuItem,
  newTestEmail,
  readCopiedNumber,
  setWalletOffline,
  settingsAccount,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'

it('account-menu-and-page', async () => {
  await withAccountFixture(async (setup, service) => {
    await runE2ECase({
      ...setup,
      caseId: 'account-menu-and-page',
      domain: 'account',
      suite: 'overview',
      description: '验证账号菜单、设置入口、本人编号、剪贴板与余额读取失败。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const trigger = accountButton(page)
        await trigger.focus()
        await trigger.press('Enter')
        await menuItem(page, labels.login).waitFor()
        await menuItem(page, labels.settings).waitFor()
        await menuItem(page, labels.help).waitFor()
        expect(await menuItem(page, labels.balance).count()).toBe(0)
        expect(await menuItem(page, labels.recharge).count()).toBe(0)
        await trigger.press('Escape')
        await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
        await trigger.click()
        await page.getByTestId('workbench-partners-list').click()
        await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')

        await trigger.click()
        await menuItem(page, labels.login).click()
        await accountPanel(page).getByText(labels.original).waitFor()
        expect(await available(page).count()).toBe(0)
        let web = await service.browserPage()
        const email = newTestEmail('overview')
        await service.authorize(runtime, web, email)
        web = await service.continueInBrowser(web)
        const websiteNumber = await service.userNumber(web)
        expect(await readCopiedNumber(runtime)).toBe(websiteNumber)
        expect(await accountPanel(page).getByText(email, { exact: true }).count()).toBe(0)
        await expect.poll(() => available(page).innerText()).toBe('¥0.00')

        await service.recharge(web)
        await accountPanel(page).getByRole('button', { name: labels.refresh }).click()
        await expect.poll(() => available(page).innerText()).toBe('¥5.00')
        await trigger.click()
        expect(await menuItem(page, labels.balance).innerText()).toContain('¥5.00')
        await menuItem(page, labels.recharge).waitFor()
        await menuItem(page, labels.billing).waitFor()
        await menuItem(page, labels.signOut).waitFor()
        await menuItem(page, labels.settings).click()
        await settingsAccount(page).click()
        expect(await page.evaluate(() => location.hash)).toBe('#/settings/account')
        await accountPanel(page).getByText(websiteNumber, { exact: true }).waitFor()
        await trigger.click()
        await menuItem(page, labels.balance).click()
        expect(await page.evaluate(() => location.hash)).toBe('#/settings/account')

        await setWalletOffline(runtime, true)
        await accountPanel(page).getByRole('button', { name: labels.refresh }).click()
        await accountPanel(page).getByText(labels.stale).waitFor()
        const retained = await available(page).innerText()
        expect(await accountPanel(page).getByText(mask(email), { exact: true }).isVisible()).toBe(
          true
        )
        await setWalletOffline(runtime, false)
        await accountPanel(page).getByRole('button', { name: labels.refresh }).click()
        await accountPanel(page).getByText(labels.stale).waitFor({ state: 'hidden' })
        await runtime.captureScreenshot({
          name: 'account-overview',
          message: '登录账号、用户编号和刷新后的可用余额'
        })
        return { retained, refreshed: await available(page).innerText() }
      },
      assert: async ({ retained, refreshed }, runtime) => {
        await runtime.assertThat(retained === '¥5.00' && refreshed === retained, {
          name: 'account-menu-and-page',
          message: '余额读取失败保留本人最后金额，恢复后正常刷新'
        })
      }
    })
  })
}, 180_000)
