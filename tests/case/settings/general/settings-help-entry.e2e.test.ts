import { describe, it } from 'vitest'
import { USER_MANUAL_URL } from '../../../../src/shared/constants'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings help e2e', () => {
  it(
    'settings-help-entry',
    async () => {
      await runE2ECase({
        caseId: 'settings-help-entry',
        domain: 'settings',
        suite: 'general',
        description: '使用帮助展示目标地址，取消不跳转，确认后打开官方手册。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToSettingsSection(page, 'model')

          const helpButton = getSettingsLocator(page, settingsSelectors.helpButton)
          await helpButton.waitFor({ state: 'visible' })
          const vectorLink = page.getByRole('link', { name: '向量模型' })
          const [helpBox, vectorBox] = await Promise.all([
            helpButton.boundingBox(),
            vectorLink.boundingBox()
          ])
          const routeBeforeClick = await page.evaluate(() => window.location.hash)
          const accessibleName = (await helpButton.getAttribute('aria-label')) || ''
          const label = (await helpButton.textContent()) || ''

          const readExternalCalls = async () =>
            (await runtime.collectSignals()).ipcInvokeEntries.filter(
              (entry) => entry.name === 'openExternal'
            )
          const baselineCallCount = (await readExternalCalls()).length
          const dialog = page.getByRole('dialog', { name: '前往官网查看使用帮助？' })
          const dismissals = []
          for (const method of ['cancel', 'escape', 'close', 'mask'] as const) {
            await helpButton.click()
            await dialog.waitFor({ state: 'visible' })
            if (method === 'cancel') {
              await dialog.getByRole('button', { name: /^取\s*消$/u }).click()
            } else if (method === 'escape') {
              await dialog.getByRole('button', { name: /^取\s*消$/u }).press('Escape')
            } else if (method === 'close') {
              await dialog.locator('.ant-modal-close').click()
            } else {
              await page.locator('.ant-modal-wrap:visible').click({ position: { x: 8, y: 80 } })
            }
            await dialog.waitFor({ state: 'hidden' })
            dismissals.push({
              method,
              externalCallCount: (await readExternalCalls()).length - baselineCallCount,
              routeUnchanged: (await page.evaluate(() => window.location.hash)) === routeBeforeClick
            })
          }

          await helpButton.click()
          await dialog.waitFor({ state: 'visible' })
          const confirmationText = await dialog.textContent()
          const callsBeforeConfirm = (await readExternalCalls()).length - baselineCallCount
          await runtime.captureScreenshot({
            name: 'help-website-confirmation',
            message: '确认后才会通过系统浏览器打开显示的官网地址'
          })
          await dialog.getByRole('button', { name: '打开官网', exact: true }).click()
          await dialog.waitFor({ state: 'hidden' })

          return {
            dismissals,
            confirmationText,
            callsBeforeConfirm,
            accessibleName,
            label,
            routeBeforeClick,
            routeAfterClick: await page.evaluate(() => window.location.hash),
            followsVectorModel:
              Boolean(helpBox && vectorBox) &&
              Math.abs((helpBox?.y || 0) - ((vectorBox?.y || 0) + (vectorBox?.height || 0))) <= 8,
            matchesMenuStyle:
              (await helpButton.getAttribute('class'))?.includes('nc-sidebar-item') || false,
            openExternalCalls: (await readExternalCalls()).slice(baselineCallCount)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.dismissals.length === 4 &&
              result.dismissals.every(
                (dismissal) => dismissal.externalCallCount === 0 && dismissal.routeUnchanged
              ),
            {
              name: 'dismiss-help-without-navigation',
              message:
                '取消、Escape、关闭和遮罩均只关闭确认框，不打开浏览器或改变设置路由，对齐 SET-HELP-001-AC3。',
              data: result.dismissals
            }
          )
          await runtime.assertThat(
            result.label.includes('使用帮助') &&
              result.accessibleName === '查看使用帮助' &&
              result.followsVectorModel &&
              result.matchesMenuStyle,
            {
              name: 'settings-help-entry-follows-vector-model',
              message:
                '“使用帮助”应紧接在“向量模型”下方，使用相同菜单样式，并具有正确的可访问名称，对齐 SET-HELP-001-AC1。',
              data: result
            }
          )
          await runtime.assertThat(
            result.confirmationText?.includes(USER_MANUAL_URL) &&
              result.callsBeforeConfirm === 0 &&
              result.openExternalCalls.length === 1 &&
              result.openExternalCalls[0]?.payload === USER_MANUAL_URL &&
              result.routeAfterClick === result.routeBeforeClick,
            {
              name: 'settings-help-entry-opens-official-manual',
              message:
                '只有确认后才通过 openExternal 打开官方中文手册，并保持当前设置页路由，对齐 SET-HELP-001-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
