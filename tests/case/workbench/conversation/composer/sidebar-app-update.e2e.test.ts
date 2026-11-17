import { describe, expect, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { assertMinimumWindowBounds } from '../../../../harness/e2e/electronApp'
import { SETTINGS_LONG_E2E_TIMEOUT_MS } from '../../../../harness/e2e/settings'
import { navigateToWorkbench, workbenchSelectors } from '../../../../harness/e2e/workbench'

const setUpdateSnapshot = async (
  page: import('playwright').Page,
  snapshot: Record<string, unknown>
) => {
  await page.evaluate(
    (detail) =>
      window.dispatchEvent(
        new CustomEvent('ncurator-e2e-app-update-set-snapshot', {
          detail: JSON.stringify(detail)
        })
      ),
    snapshot
  )
}

describe('sidebar app update e2e', () => {
  it(
    'sidebar-app-update',
    async () => {
      await runE2ECase({
        caseId: 'sidebar-app-update',
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '账号菜单版本行、同行圆环更新、未知进度及独立操作的真实 Electron 回归。',
        fixtures: ['app-update-fixture'],
        serviceMode: 'fixture',
        fixtureReason: '既有更新 fixture 控制五种更新状态及真实未知进度边界，不验证真实更新渠道。',
        extraEnv: { NCURATOR_DISTRIBUTION: 'domestic' },
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const trigger = page.getByTestId('desktop-account-menu')
          const update = page.getByTestId(workbenchSelectors.updateButton)
          const label = page.getByTestId(workbenchSelectors.updateButtonLabel)
          const version = page.getByTestId(workbenchSelectors.appVersion)
          const base = {
            currentVersion: '0.1.0',
            availableVersion: '0.1.1',
            isPackaged: true,
            updateSupported: true,
            platform: 'darwin'
          }
          const native = await runtime.electronApp.browserWindow(page)
          const original = await native.evaluate((window) => window.getBounds())
          async function closeMenu() {
            if ((await trigger.getAttribute('aria-expanded')) === 'true')
              await trigger.press('Escape')
            await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
          }
          async function inspectMenu(name: string) {
            if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
            await expect.poll(() => version.innerText()).toBe('v0.1.0')
            await page.locator('.nc-account-dropdown').evaluate(async (element) => {
              await Promise.all(
                element
                  .getAnimations({ subtree: true })
                  .map((animation) => animation.finished.catch(() => {}))
              )
            })
            expect(await version.locator('button,a').count()).toBe(0)
            const geometry = await native.evaluate((window) => ({
              bounds: window.getBounds(),
              content: window.getContentBounds(),
              minimum: window.getMinimumSize(),
              zoom: window.webContents.getZoomFactor()
            }))
            if (name.endsWith('-minimum')) {
              assertMinimumWindowBounds(geometry.bounds, geometry.minimum)
            }
            const view = await page.locator('.nc-account-popup').evaluate((element) => {
              const box = element.getBoundingClientRect()
              return {
                top: box.top,
                bottom: box.bottom,
                viewport: innerHeight,
                height: element.clientHeight,
                scroll: element.scrollHeight,
                dpr: devicePixelRatio,
                width: innerWidth
              }
            })
            expect(view.top).toBeGreaterThanOrEqual(0)
            expect(view.bottom).toBeLessThanOrEqual(view.viewport)
            expect(view.scroll).toBeLessThanOrEqual(view.height + 1)
            if (await update.isVisible()) {
              const [accountBox, updateBox] = await Promise.all([
                trigger.boundingBox(),
                update.boundingBox()
              ])
              expect(accountBox!.x + accountBox!.width).toBeLessThanOrEqual(updateBox!.x)
              expect(
                Math.abs(
                  accountBox!.y + accountBox!.height / 2 - updateBox!.y - updateBox!.height / 2
                )
              ).toBeLessThan(2)
            }
            await runtime.assertThat(true, {
              name,
              message: '账号和更新独立操作，菜单及版本行未裁切',
              data: { ...geometry, ...view }
            })
            await runtime.captureScreenshot({ name, message: '真实 Electron 更新状态与账号菜单' })
            await closeMenu()
          }
          const states = [
            { name: 'idle', status: 'idle' },
            { name: 'available', status: 'available' },
            { name: 'downloading', status: 'downloading', progressPercent: 42 },
            { name: 'unknown', status: 'downloading' },
            { name: 'error', status: 'error', error: 'download interrupted' }
          ]
          for (const state of states) {
            await setUpdateSnapshot(page, { ...base, ...state })
            if (state.status === 'idle') expect(await update.count()).toBe(0)
            else await update.waitFor({ state: 'visible' })
            if (state.status === 'downloading') {
              await expect.poll(() => update.isDisabled()).toBe(true)
              const progress = update.getByRole('progressbar')
              await progress.waitFor()
              await expect
                .poll(() => progress.getAttribute('aria-valuenow'))
                .toBe(state.name === 'unknown' ? null : '42')
              await expect
                .poll(() => label.innerText())
                .toBe(state.name === 'unknown' ? '下载中' : '42%')
            }
            await native.evaluate((window, bounds) => window.setBounds(bounds), original)
            await inspectMenu(state.name + '-normal')
            await native.evaluate((window) => window.setSize(1400, 800))
            await inspectMenu(state.name + '-minimum')
          }
          for (const progressPercent of [0, 100, -1, 101]) {
            await setUpdateSnapshot(page, { ...base, status: 'downloading', progressPercent })
            await expect
              .poll(() => label.innerText())
              .toBe(
                progressPercent >= 0 && progressPercent <= 100 ? `${progressPercent}%` : '下载中'
              )
            await expect.poll(() => update.isDisabled()).toBe(true)
          }
          await setUpdateSnapshot(page, { ...base, status: 'available' })
          await update.click()
          await expect.poll(() => label.innerText()).toBe('42%')
          await trigger.click()
          await version.waitFor({ state: 'visible' })
          expect(await trigger.isEnabled()).toBe(true)
          await closeMenu()
          const restart = page.getByRole('dialog', { name: '更新已准备好' })
          await restart.waitFor()
          await page.getByTestId(workbenchSelectors.updateRestartLaterButton).click()
          await expect.poll(() => label.innerText()).toBe('重启')
          await native.evaluate((window, bounds) => window.setBounds(bounds), original)
          await inspectMenu('downloaded-normal')
          await native.evaluate((window) => window.setSize(1400, 800))
          await inspectMenu('downloaded-minimum')
          await update.click()
          await setUpdateSnapshot(page, {
            ...base,
            status: 'error',
            availableVersion: '0.1.2',
            error: 'download interrupted'
          })
          await expect.poll(() => label.innerText()).toBe('重试')
          await update.click()
          await expect.poll(() => label.innerText()).toBe('42%')
          await trigger.click()
          expect(await trigger.isEnabled()).toBe(true)
          await version.waitFor({ state: 'visible' })
          await closeMenu()
          await restart.waitFor()
          await page.getByTestId(workbenchSelectors.updateRestartLaterButton).click()
          await page.goto(`${page.url().split('#')[0]}#/settings/app`)
          await page.waitForURL(/#\/settings\/model$/u)
          expect(await page.getByTestId('settings-page').innerText()).not.toContain('应用更新')
          const signals = await runtime.collectSignals()
          const calls = signals.ipcInvokeEntries.map((entry) => entry.name)
          expect(calls.filter((name) => name === 'appUpdateDownload').length).toBe(2)
          expect(calls).toContain('appUpdateInstall')
          return { calls }
        },
        assert: async (_, runtime) =>
          runtime.assertThat(true, {
            name: 'update-states-and-independent-account',
            message: '五状态、未知进度、重试、重启与原生窗口检查通过；不代表真实安装升级'
          })
      })
    },
    SETTINGS_LONG_E2E_TIMEOUT_MS
  )
})
