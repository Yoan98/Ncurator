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
        suite: 'model',
        description: '设置页在向量模型下方展示同级使用帮助入口，并打开官方手册。',
        fixtures: [],
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

          await helpButton.click()
          const signals = await runtime.collectSignals()

          return {
            accessibleName,
            label,
            routeBeforeClick,
            routeAfterClick: await page.evaluate(() => window.location.hash),
            followsVectorModel:
              Boolean(helpBox && vectorBox) &&
              Math.abs((helpBox?.y || 0) - ((vectorBox?.y || 0) + (vectorBox?.height || 0))) <= 8,
            matchesMenuStyle:
              (await helpButton.getAttribute('class'))?.includes('nc-sidebar-item') || false,
            openExternalCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openExternal'
            )
          }
        },
        assert: async (result, runtime) => {
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
            result.openExternalCalls.some((entry) => entry.payload === USER_MANUAL_URL) &&
              result.routeAfterClick === result.routeBeforeClick,
            {
              name: 'settings-help-entry-opens-official-manual',
              message:
                '点击“使用帮助”后应通过 openExternal 打开官方中文手册，并保持当前设置页路由，对齐 SET-HELP-001-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
