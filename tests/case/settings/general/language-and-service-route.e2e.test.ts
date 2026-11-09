import { describe, it } from 'vitest'
import type { Page } from 'playwright'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { navigateToSettingsSection, SETTINGS_E2E_TIMEOUT_MS } from '../../../harness/e2e/settings'
import { createPartnerThroughWorkbenchUi } from '../../../harness/e2e/workbench'
import {
  settingsSelectors,
  workbenchSelectors
} from '../../../../src/renderer/src/testing/selectors'

const CSS_LAYOUT_TOLERANCE_PX = 0.05

const readSettingsLayout = async (page: Page) =>
  page.evaluate(() => {
    const content = document.querySelector('.nc-settings-content')!
    const pane = document.querySelector('.nc-settings-main-pane')!
    const contentRect = content.getBoundingClientRect()
    const paneRect = pane.getBoundingClientRect()
    const general = document.querySelector('.nc-settings-general')
    return {
      width: contentRect.width,
      centered:
        Math.abs(contentRect.x + contentRect.width / 2 - paneRect.x - paneRect.width / 2) < 2,
      groups: Array.from(document.querySelectorAll('.nc-settings-group-title')).map(
        (heading) => heading.textContent
      ),
      noHorizontalOverflow: !general || general.scrollWidth <= general.clientWidth,
      controlsFit: Array.from(document.querySelectorAll('.nc-settings-row-control')).every(
        (control) => {
          const row = control.closest('.nc-settings-row')!.getBoundingClientRect()
          const rect = control.getBoundingClientRect()
          return rect.left >= row.left && rect.right <= row.right + 1
        }
      ),
      selectHeights: Array.from(document.querySelectorAll('.nc-settings-preference-select')).map(
        (select) => select.getBoundingClientRect().height
      )
    }
  })

describe('application language and service region', () => {
  it(
    'language-and-service-route',
    async () => {
      await runE2ECase({
        caseId: 'language-and-service-route',
        domain: 'settings',
        suite: 'general',
        description: 'Language changes apply after restart while the distribution stays fixed.',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          await runtime.page.setViewportSize({ width: 1600, height: 1000 })
          await navigateToSettingsSection(runtime.page, 'general')
          await runtime.page.getByRole('heading', { name: '应用偏好', exact: true }).waitFor()
          const chineseLayout = await readSettingsLayout(runtime.page)
          await runtime.captureScreenshot({
            name: 'chinese-grouped-settings',
            message: '中文通用页分组面板与限宽布局'
          })
          const initial = await runtime.page.evaluate(() => window.api.appSettingsGet())
          await runtime.page.getByTestId('settings-language').click()
          await runtime.page.getByTitle('English', { exact: true }).click()
          await runtime.page.waitForFunction(
            async () => (await window.api.appSettingsGet()).language === 'en'
          )
          await runtime.page.getByTestId(settingsSelectors.systemNotificationsSwitch).click()
          await runtime.restartApp()
          await runtime.page.setViewportSize({ width: 1600, height: 1000 })
          await navigateToSettingsSection(runtime.page, 'general')
          const saved = await runtime.page.evaluate(() => window.api.appSettingsGet())
          const language = await runtime.page.locator('html').getAttribute('lang')
          const englishVisible = await runtime.page
            .getByText('Interface language', { exact: true })
            .isVisible()
          await runtime.captureScreenshot({
            name: 'english-general-settings',
            message: 'English settings layout without a service-region switch'
          })
          const englishLayout = await readSettingsLayout(runtime.page)
          await runtime.page.getByTestId(settingsSelectors.helpButton).click()
          const helpDialog = runtime.page.getByRole('dialog', { name: 'Open help on the website?' })
          await helpDialog.waitFor({ state: 'visible' })
          const englishHelpText = await helpDialog.textContent()
          await runtime.captureScreenshot({
            name: 'english-help-confirmation',
            message: '英文确认框展示本发行版英文手册地址'
          })
          await helpDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
          await helpDialog.waitFor({ state: 'hidden' })
          await runtime.page.setViewportSize({ width: 720, height: 800 })
          const narrowLayout = await readSettingsLayout(runtime.page)
          await runtime.captureScreenshot({
            name: 'english-narrow-settings',
            message: '窄窗口英文说明换行与操作完整可见'
          })
          await runtime.page.setViewportSize({ width: 1600, height: 1000 })
          const otherLayouts = []
          for (const section of ['model', 'workspace', 'vector'] as const) {
            await navigateToSettingsSection(runtime.page, section)
            await runtime.page.locator('.nc-settings-panel').first().waitFor()
            otherLayouts.push({ section, ...(await readSettingsLayout(runtime.page)) })
            await runtime.captureScreenshot({
              name: `english-${section}-settings`,
              message: '设置页共用页头与分组面板'
            })
            if (section === 'workspace') {
              await runtime.page.getByRole('tab', { name: /Webpage/u }).click()
              await runtime.page.getByRole('button', { name: 'Add webpage', exact: true }).waitFor()
              await runtime.captureScreenshot({
                name: 'english-web-sources-settings',
                message: '网页资料与文件地址使用一致的分组面板'
              })
            }
          }
          await navigateToSettingsSection(runtime.page, 'general')
          const routeControlAbsent = (await runtime.page.getByTestId('settings-service-route').count()) === 0
          await runtime.page.getByTestId(settingsSelectors.backRow).click()
          await createPartnerThroughWorkbenchUi(runtime.page, 'English UI check')
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
          return {
            initial,
            saved,
            language,
            englishVisible,
            englishBrand,
            routeControlAbsent,
            chineseLayout,
            englishLayout,
            englishHelpText,
            narrowLayout,
            otherLayouts
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.englishHelpText?.includes(result.initial.serviceRoute === 'international' ? 'https://www.ncurator.com/en/manual' : 'https://www.guanzhangai.cn/en/manual') &&
              result.englishHelpText.includes('Open website'),
            {
              name: 'localized-help-confirmation-and-destination',
              message: '英文帮助确认框应展示所属发行版的英文手册和确认操作。',
              data: { englishHelpText: result.englishHelpText }
            }
          )
          await runtime.assertThat(
            Math.abs(result.chineseLayout.width - 1080) <= CSS_LAYOUT_TOLERANCE_PX &&
              Math.abs(result.englishLayout.width - 1080) <= CSS_LAYOUT_TOLERANCE_PX &&
              result.chineseLayout.groups.join(',') === '应用偏好,数据与诊断' &&
              result.englishLayout.groups.join(',') === 'App preferences,Data and diagnostics' &&
              [result.chineseLayout, result.englishLayout, result.narrowLayout].every(
                (layout) =>
                  layout.width <= 1080 + CSS_LAYOUT_TOLERANCE_PX &&
                  layout.centered &&
                  layout.noHorizontalOverflow &&
                  layout.controlsFit &&
                  layout.selectHeights.length === 1 &&
                  layout.selectHeights.every(
                    (height) => Math.abs(height - 32) <= CSS_LAYOUT_TOLERANCE_PX
                  )
              ) &&
              result.otherLayouts.every(
                (layout) =>
                  layout.centered && Math.abs(layout.width - result.englishLayout.width) < 1
              ),
            {
              name: 'grouped-settings-responsive-layout',
              message:
                '中英文通用页分组、限宽、32px 控件及窄窗口无横向溢出，所有设置页按大模型页宽度统一居中。',
              data: result
            }
          )
          await runtime.assertThat(
            result.initial.serviceRoute === (process.env.NCURATOR_DISTRIBUTION || 'domestic') && result.initial.language === 'system',
            {
              name: 'distribution-initial-preferences',
              message: 'The application uses its configured distribution.',
              data: result.initial
            }
          )
          await runtime.assertThat(
            result.saved.language === 'en' &&
              result.saved.serviceRoute === result.initial.serviceRoute &&
              result.saved.systemNotificationsEnabled === false &&
              result.language === 'en' &&
              result.englishVisible &&
              result.routeControlAbsent &&
              result.englishBrand?.includes('NCurator'),
            {
              name: 'independent-persistent-preferences',
              message:
                'Language persists and no setting changes the official service region.',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 2
  )
})
