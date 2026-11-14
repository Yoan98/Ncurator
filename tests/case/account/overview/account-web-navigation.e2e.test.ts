import { expect, it } from 'vitest'
import {
  accountButton,
  accountPanel,
  available,
  externalUrls,
  labels,
  mask,
  menuItem,
  newTestEmail,
  readCopiedNumber,
  returnToDesktop,
  walletReads,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'

const site = 'https://www.guanzhangai.cn'
const rechargeUrl = site + '/account/recharge'
const billingUrl = site + '/account/billing'

it('account-web-navigation', async () => {
  await withAccountFixture(async (setup, service) => {
    await runE2ECase({
      ...setup,
      caseId: 'account-web-navigation',
      domain: 'account',
      suite: 'overview',
      description: '验证官网充值与账单、网页身份独立、充值回桌面和海外入口隔离。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const trigger = accountButton(page)
        await trigger.click()
        await menuItem(page, labels.login).click()
        const desktopEmail = newTestEmail('desktop')
        let web = await service.browserPage()
        await service.authorize(runtime, web, desktopEmail)
        web = await service.continueInBrowser(web)
        const desktopNumber = await service.userNumber(web)
        expect(await readCopiedNumber(runtime)).toBe(desktopNumber)
        await expect.poll(() => available(page).innerText()).toBe('¥0.00')
        await trigger.click()
        const contact =
          (await page.locator('html').getAttribute('lang')) === 'zh-CN'
            ? site + '/zh/contact'
            : site + '/en/contact'
        await menuItem(page, labels.help).click()
        await expect.poll(async () => (await externalUrls(runtime)).at(-1)).toBe(contact)
        await trigger.click()
        expect(await menuItem(page, labels.refund).count()).toBe(0)
        await menuItem(page, labels.recharge).click()
        await expect.poll(async () => (await externalUrls(runtime)).at(-1)).toBe(rechargeUrl)
        await trigger.click()
        await menuItem(page, labels.billing).click()
        await expect.poll(async () => (await externalUrls(runtime)).at(-1)).toBe(billingUrl)
        expect(await accountPanel(page).getByRole('button', { name: labels.refund }).count()).toBe(
          0
        )

        const differentBrowser = await service.browserPage()
        await service.signIn(differentBrowser, newTestEmail('browser'), rechargeUrl)
        expect(await service.userNumber(differentBrowser)).not.toBe(desktopNumber)
        expect(
          await accountPanel(page).getByText(mask(desktopEmail), { exact: true }).isVisible()
        ).toBe(true)
        const billingBrowser = await service.browserPage()
        await service.signIn(billingBrowser, newTestEmail('billing'), billingUrl)
        await billingBrowser.getByRole('heading', { name: '账单', exact: true }).waitFor()

        await accountPanel(page).getByRole('button', { name: labels.billing, exact: true }).click()
        await expect.poll(async () => (await externalUrls(runtime)).at(-1)).toBe(billingUrl)
        await accountPanel(page).getByRole('button', { name: labels.recharge, exact: true }).click()
        await expect.poll(async () => (await externalUrls(runtime)).at(-1)).toBe(rechargeUrl)
        await service.recharge(web)
        const before = await walletReads(runtime)
        await returnToDesktop(runtime)
        await expect.poll(() => walletReads(runtime)).toBe(before + 1)
        await expect.poll(() => available(page).innerText()).toBe('¥5.00')
        await returnToDesktop(runtime)
        expect(await walletReads(runtime)).toBe(before + 1)
        await runtime.captureScreenshot({
          name: 'recharge-return',
          message: '官网充值到账后桌面立即取得新的余额'
        })

        await service.checkOverseas()
        const urls = (await externalUrls(runtime)).slice(1)
        expect(urls).toEqual([contact, rechargeUrl, billingUrl, billingUrl, rechargeUrl])
        return { count: urls.length, balance: await available(page).innerText() }
      },
      assert: async ({ count, balance }, runtime) => {
        await runtime.assertThat(count === 5 && balance === '¥5.00', {
          name: 'account-web-navigation',
          message: '只打开预期的官网地址，返回桌面显示本人到账金额'
        })
      }
    })
  })
}, 180_000)
