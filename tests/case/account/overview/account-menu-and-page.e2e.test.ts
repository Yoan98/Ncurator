import { expect, it } from 'vitest'
import {
  accountButton,
  available,
  labels,
  mask,
  menuItem,
  newTestEmail,
  openAccountMenu,
  readDesktopUserNo,
  refreshWallet,
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
      description: '验证账号菜单、官网头像样式、设置导航和余额读取失败。',
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
        const login = menuItem(page, labels.login)
        const offerText = '享受 DeepSeek 模型超低折扣'
        const offer = login.getByText(offerText, { exact: true })
        await offer.waitFor()
        const loginTitle = await login.getByText('登录', { exact: true }).elementHandle()
        const offerBelowTitle = await offer.evaluate(
          (element, title) =>
            element.getBoundingClientRect().top >= title.getBoundingClientRect().bottom,
          loginTitle
        )
        expect(offerBelowTitle).toBe(true)
        const offerLayout = () =>
          offer.evaluate((text) => {
            const popup = text.closest('.nc-account-popup')!
            const bounds = popup.getBoundingClientRect()
            const badge = text.parentElement!.getBoundingClientRect()
            const arrow = text.closest('.nc-account-menu-label')!.querySelector(':scope > svg')!
            return {
              gap: arrow.getBoundingClientRect().left - badge.right,
              height: badge.height,
              width: bounds.width,
              fits:
                bounds.left >= 0 &&
                bounds.right <= innerWidth &&
                popup.scrollWidth <= popup.clientWidth + 1
            }
          })
        await expect.poll(async () => (await offerLayout()).gap).toBeCloseTo(12, 0)
        const normalOffer = await offerLayout()
        await expect
          .poll(() =>
            page
              .locator('.nc-account-dropdown')
              .evaluate((popup) => getComputedStyle(popup).opacity)
          )
          .toBe('1')
        await runtime.captureScreenshot({
          name: 'account-login-menu-normal',
          message: '未登录菜单按内容定宽'
        })
        const menu = page.getByRole('menu')
        expect(await menu.getByRole('menuitem').allTextContents()).toEqual([
          `登录🎁${offerText}`,
          '设置',
          '帮助'
        ])
        expect(await menu.getByText('账号', { exact: true }).count()).toBe(0)
        expect(await trigger.getByTestId('desktop-account-avatar').locator('svg').isVisible()).toBe(
          true
        )
        await trigger.press('Escape')
        await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
        await trigger.click()
        await page.getByTestId('workbench-partners-list').click()
        await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')

        await trigger.click()
        await menuItem(page, labels.settings).click()
        await page.getByTestId('settings-page').waitFor()
        expect(await settingsAccount(page).count()).toBe(0)
        await page.getByTestId('settings-back-row').click()
        let web = await service.browserPage()
        const email = newTestEmail('overview')
        await service.authorize(runtime, web, email)
        const avatar = trigger.getByTestId('desktop-account-avatar')
        await expect.poll(() => avatar.innerText()).toBe(email[0].toUpperCase())
        const readAvatarColors = (element: HTMLElement | SVGElement) => {
          const { backgroundColor, borderTopColor, color } = getComputedStyle(element)
          return [backgroundColor, borderTopColor, color]
        }
        const avatarColors = ['rgb(221, 244, 231)', 'rgb(200, 231, 215)', 'rgb(36, 87, 65)']
        expect(await avatar.evaluate(readAvatarColors)).toEqual(avatarColors)
        await openAccountMenu(page)
        expect(await menu.getByText(offerText, { exact: true }).count()).toBe(0)
        const menuAvatar = menu.getByTestId('desktop-account-avatar')
        expect(await menuAvatar.innerText()).toBe(email[0].toUpperCase())
        expect(await menuAvatar.evaluate(readAvatarColors)).toEqual(avatarColors)
        expect(await menu.getByText(email, { exact: true }).count()).toBe(0)
        web = await service.continueInBrowser(web)
        const websiteNumber = await service.userNumber(web)
        expect(await readDesktopUserNo(page)).toBe(websiteNumber)
        await expect.poll(() => available(page).innerText()).toBe('¥0.00')

        await service.recharge(web)
        await refreshWallet(page)
        await expect.poll(() => available(page).innerText()).toBe('¥5.00')
        expect(await menuItem(page, labels.balance).innerText()).toContain('¥5.00')
        await menuItem(page, labels.recharge).waitFor()
        await menuItem(page, labels.billing).waitFor()
        await menuItem(page, labels.signOut).waitFor()
        const items = await menu.getByRole('menuitem').allTextContents()
        expect(items.map((text) => text.replace(/\s/g, ''))).toEqual([
          expect.stringMatching(/可用余额.*¥5\.00/),
          '充值',
          '账单',
          '设置',
          '帮助',
          '退出登录'
        ])
        expect(await menuItem(page, labels.signOut).locator('svg').count()).toBe(1)
        const grouping = (name: RegExp) =>
          menuItem(page, name).evaluate((item) => ({
            before: item.previousElementSibling?.getAttribute('role'),
            after: item.nextElementSibling?.getAttribute('role')
          }))
        expect(await grouping(labels.settings)).toEqual({ before: 'separator', after: 'menuitem' })
        expect(await grouping(labels.help)).toEqual({ before: 'menuitem', after: 'separator' })
        const version = page.getByTestId('workbench-app-version')
        const runningVersion = await runtime.electronApp.evaluate(({ app }) => app.getVersion())
        await expect.poll(() => version.innerText()).toBe('v' + runningVersion)
        expect(await version.locator('button,a').count()).toBe(0)
        const nativeWindow = await runtime.electronApp.browserWindow(page)
        const initial = await nativeWindow.evaluate((window) => window.getBounds())
        for (const size of [undefined, { width: 1400, height: 800 }]) {
          if (size)
            await nativeWindow.evaluate(
              (window, bounds) => window.setSize(bounds.width, bounds.height),
              size
            )
          const geometry = await nativeWindow.evaluate((window) => ({
            bounds: window.getBounds(),
            content: window.getContentBounds(),
            minimum: window.getMinimumSize(),
            zoom: window.webContents.getZoomFactor()
          }))
          expect(geometry.minimum).toEqual([1400, 800])
          if (size) expect(geometry.bounds).toMatchObject(size)
          const visible = await page.locator('.nc-account-popup').evaluate((element) => {
            const box = element.getBoundingClientRect()
            return {
              top: box.top,
              bottom: box.bottom,
              viewport: innerHeight,
              scroll: element.scrollHeight,
              height: element.clientHeight,
              dpr: devicePixelRatio,
              width: innerWidth
            }
          })
          expect(visible.top).toBeGreaterThanOrEqual(0)
          expect(visible.bottom).toBeLessThanOrEqual(visible.viewport)
          expect(visible.scroll).toBeLessThanOrEqual(visible.height + 1)
          await runtime.assertThat(true, {
            name: size ? 'actual-minimum-window' : 'normal-window',
            message: '账号菜单在原生窗口内完整可见',
            data: { ...geometry, ...visible }
          })
          await runtime.captureScreenshot({
            name: size ? 'account-menu-minimum' : 'account-menu-normal',
            message: '真实 Electron 账号菜单，含版本行和退出登录图标'
          })
        }
        await nativeWindow.evaluate((window, bounds) => window.setBounds(bounds), initial)
        await menuItem(page, labels.settings).click()
        expect(await page.evaluate(() => location.hash)).toBe('#/settings/general')
        expect(await settingsAccount(page).count()).toBe(0)
        await openAccountMenu(page)

        await setWalletOffline(runtime, true)
        await refreshWallet(page)
        await page.getByRole('status').getByText(labels.stale).waitFor()
        const retained = await available(page).innerText()
        await menu.getByText(mask(email), { exact: true }).waitFor({ state: 'visible' })
        await setWalletOffline(runtime, false)
        await refreshWallet(page)
        await page.getByRole('status').getByText(labels.stale).waitFor({ state: 'hidden' })
        const refreshed = await available(page).innerText()
        await menuItem(page, labels.signOut).click()
        await openAccountMenu(page)
        await menuItem(page, labels.login).waitFor()
        expect(await service.userNumber(web)).toBe(websiteNumber)
        expect(await runtime.electronApp.evaluate(({ app }) => app.isReady())).toBe(true)
        const viewport =
          page.viewportSize() ??
          (await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight
          })))
        try {
          await page.setViewportSize({ width: 220, height: viewport.height })
          await expect.poll(async () => (await offerLayout()).width).toBeLessThan(normalOffer.width)
          await expect
            .poll(async () => (await offerLayout()).height)
            .toBeGreaterThan(normalOffer.height)
          await expect.poll(async () => (await offerLayout()).fits).toBe(true)
          await version.waitFor()
        } finally {
          await page.setViewportSize(viewport)
        }
        return { retained, refreshed }
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
