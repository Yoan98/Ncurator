import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { navigateToSettingsSection, SETTINGS_E2E_TIMEOUT_MS } from '../../../harness/e2e/settings'
import {
  settingsSelectors,
  workbenchSelectors
} from '../../../../src/renderer/src/testing/selectors'

describe('application language and service region', () => {
  it(
    'language-and-service-route',
    async () => {
      await runE2ECase({
        caseId: 'language-and-service-route',
        domain: 'settings',
        suite: 'general',
        description: 'Language changes apply after restart; service regions persist independently.',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          await navigateToSettingsSection(runtime.page, 'general')
          const initial = await runtime.page.evaluate(() => window.api.appSettingsGet())
          await runtime.page.getByTestId('settings-language').click()
          await runtime.page.getByTitle('English', { exact: true }).click()
          await runtime.page.waitForFunction(
            async () => (await window.api.appSettingsGet()).language === 'en'
          )
          await runtime.page.getByTestId('settings-service-route').click()
          await runtime.page.getByTitle('国际', { exact: true }).click()
          await runtime.page.waitForFunction(
            async () => (await window.api.appSettingsGet()).serviceRoute === 'international'
          )
          await runtime.page.getByTestId(settingsSelectors.systemNotificationsSwitch).click()
          await runtime.restartApp()
          await navigateToSettingsSection(runtime.page, 'general')
          const saved = await runtime.page.evaluate(() => window.api.appSettingsGet())
          const language = await runtime.page.locator('html').getAttribute('lang')
          const englishVisible = await runtime.page
            .getByText('Interface language', { exact: true })
            .isVisible()
          await runtime.captureScreenshot({
            name: 'english-general-settings',
            message: 'English settings layout and independent service region'
          })
          const choices = await runtime.page.getByTestId('settings-service-route').textContent()
          await runtime.page.getByTestId('settings-service-route').click()
          const optionCount = await runtime.page
            .locator(
              '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'
            )
            .count()
          await runtime.page.getByTitle('Mainland China', { exact: true }).click()
          await runtime.page.waitForFunction(
            async () => (await window.api.appStartupGetStatus()).serviceRoute === 'domestic'
          )
          await runtime.page.getByTestId(settingsSelectors.backRow).click()
          await runtime.page.getByTestId(workbenchSelectors.newPartnerButton).click()
          const partnerName = runtime.page.getByTestId(workbenchSelectors.createPartnerNameInput)
          await partnerName.fill('English UI check')
          const modal = runtime.page.getByTestId(workbenchSelectors.createPartnerModal)
          await modal.locator('.ant-modal-footer .ant-btn-primary').click()
          await modal.waitFor({ state: 'hidden' })
          await runtime.page.getByTestId(workbenchSelectors.input).waitFor({ state: 'visible' })
          const englishBrand = await runtime.page.title()
          await runtime.page.waitForTimeout(500)
          await runtime.captureScreenshot({
            name: 'english-workbench',
            message: 'English workbench after creating a partner through the UI'
          })
          await navigateToSettingsSection(runtime.page, 'general')
          await runtime.page.getByTestId('settings-language').click()
          await runtime.page.getByTitle('简体中文', { exact: true }).click()
          return { initial, saved, language, englishVisible, choices, englishBrand, optionCount }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.initial.serviceRoute === 'domestic' && result.initial.language === 'system',
            {
              name: 'domestic-initial-preferences',
              message: 'Domestic installation initializes the domestic service region.',
              data: result.initial
            }
          )
          await runtime.assertThat(
            result.saved.language === 'en' &&
              result.saved.serviceRoute === 'international' &&
              result.saved.systemNotificationsEnabled === false &&
              result.language === 'en' &&
              result.englishVisible &&
              result.optionCount === 2 &&
              result.englishBrand?.includes('NCurator'),
            {
              name: 'independent-persistent-preferences',
              message:
                'Language and region persist independently with exactly two service options.',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
