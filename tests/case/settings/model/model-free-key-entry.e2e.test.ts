import { describe, it } from 'vitest'
import { FREE_AI_KEYS_URL } from '../../../../src/shared/constants'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings model free key e2e', () => {
  it(
    'model-free-key-entry',
    async () => {
      await runE2ECase({
        caseId: 'model-free-key-entry',
        domain: 'settings',
        suite: 'model',
        description: '大模型配置页提供免费 AI Key 官网入口。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToSettingsSection(page, 'model')

          const count = getSettingsLocator(page, settingsSelectors.modelConfigCount)
          const freeKeyButton = getSettingsLocator(page, settingsSelectors.modelFreeKeyButton)
          const addButton = getSettingsLocator(page, settingsSelectors.modelAddButton)
          await freeKeyButton.waitFor({ state: 'visible' })

          const [countBox, freeKeyBox, addBox] = await Promise.all([
            count.boundingBox(),
            freeKeyButton.boundingBox(),
            addButton.boundingBox()
          ])
          const routeBeforeClick = await page.evaluate(() => window.location.hash)
          const label = (await freeKeyButton.textContent()) || ''
          const accessibleName = (await freeKeyButton.getAttribute('aria-label')) || ''

          await freeKeyButton.click()
          const signals = await runtime.collectSignals()

          return {
            label,
            accessibleName,
            routeBeforeClick,
            routeAfterClick: await page.evaluate(() => window.location.hash),
            placedBetweenCountAndAdd:
              Boolean(countBox && freeKeyBox && addBox) &&
              (countBox?.x || 0) + (countBox?.width || 0) <= (freeKeyBox?.x || 0) &&
              (freeKeyBox?.x || 0) + (freeKeyBox?.width || 0) <= (addBox?.x || 0),
            alignedWithActions:
              Boolean(countBox && freeKeyBox && addBox) &&
              Math.abs((freeKeyBox?.y || 0) - (addBox?.y || 0)) <= 2,
            openExternalCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openExternal'
            )
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.label.includes('免费获取 AI Key') &&
              result.accessibleName === '免费获取 AI Key' &&
              result.placedBetweenCountAndAdd &&
              result.alignedWithActions,
            {
              name: 'model-free-key-entry-placement',
              message: '免费 AI Key 入口应位于配置数量与新增配置按钮之间，并保持操作区对齐。',
              data: result
            }
          )
          await runtime.assertThat(
            result.openExternalCalls.some((entry) => entry.payload === FREE_AI_KEYS_URL) &&
              result.routeAfterClick === result.routeBeforeClick,
            {
              name: 'model-free-key-entry-opens-official-page',
              message: '点击免费 AI Key 入口后应通过系统浏览器打开官网免费 Key 页面。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
