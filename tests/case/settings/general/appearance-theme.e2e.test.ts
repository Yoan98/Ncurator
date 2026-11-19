import { describe, it } from 'vitest'
import type { ElectronApplication, Page } from 'playwright'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  navigateToSettingsSection,
  SETTINGS_E2E_TIMEOUT_MS,
  waitForSettingsAppReady
} from '../../../harness/e2e/settings'
import { settingsSelectors, workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { AppResolvedTheme, AppTheme } from '../../../../src/shared/appPreferences'

const CASE_ID = 'appearance-theme'

/** 主题选项在设置页的展示文案：通过 UI 点选，不直接调 IPC 改设置。 */
const THEME_OPTION_LABELS: Record<AppTheme, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色'
}

/** 深色主题下主要表面的亮度上限：超过即视为「白底残留」。 */
const WHITE_LUMA_THRESHOLD = 0.7

type SurfaceSample = { label: string; color: string; luma: number }

type ThemeSnapshot = {
  dataTheme: AppResolvedTheme | null
  pageToken: string
  surfaces: SurfaceSample[]
}

const readThemeSnapshot = async (page: Page): Promise<ThemeSnapshot> =>
  page.evaluate(() => {
    const root = document.documentElement
    const luma = (value: string): number => {
      const match = value.match(/rgba?\(([^)]+)\)/u)
      if (!match) return Number.NaN
      const [r, g, b] = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
      const channel = (value255: number): number => {
        const unit = value255 / 255
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const sample = (label: string, selector: string): SurfaceSample | null => {
      const element = document.querySelector(selector)
      if (!element) return null
      // 隐藏元素（如无伙伴时的 composer）没有可见表面，跳过而不是误判为白底。
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const color = getComputedStyle(element).backgroundColor
      return { label, color, luma: luma(color) }
    }
    const surfaces = [
      sample('body', 'body'),
      sample('sidebar', 'aside'),
      sample('composer', '.nc-floating-composer')
    ].filter((item): item is SurfaceSample => item !== null)
    return {
      dataTheme: (root.dataset.theme as AppResolvedTheme | undefined) ?? null,
      pageToken: getComputedStyle(root).getPropertyValue('--notion-page').trim(),
      surfaces
    }
  })

const readStoredTheme = async (page: Page): Promise<AppTheme | undefined> => {
  const settings = await page.evaluate(() => window.api.appSettingsGet())
  return settings.theme
}

const readNativeThemeSource = async (app: ElectronApplication): Promise<string | null> =>
  app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)

const selectThemeThroughUi = async (page: Page, theme: AppTheme): Promise<void> => {
  const themeSelect = page.getByTestId(settingsSelectors.themeSelect)
  await themeSelect.click()
  // 「语言」下拉也有同名项（如「跟随系统」），只选下拉面板里的选项元素。
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: THEME_OPTION_LABELS[theme] })
    .first()
    .click()
  // data-theme 同步生效；持久化走 IPC，需要等主进程真的落库。
  await page.waitForFunction(
    async (expected: string) => {
      const applied = document.documentElement.dataset.theme
      if (!applied) return false
      if (expected === 'system') return true
      if (applied !== expected) return false
      const settings = await window.api.appSettingsGet()
      return settings.theme === expected
    },
    theme,
    { timeout: 15_000 }
  )
}

describe('appearance theme', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'settings',
        suite: 'general',
        description: '通用设置可切换跟随系统 / 浅色 / 深色，主题即时生效并通过真实 IPC 持久化。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await page.setViewportSize({ width: 1600, height: 1000 })
          await waitForSettingsAppReady(page)
          await navigateToSettingsSection(page, 'general')
          await page.getByRole('heading', { name: '应用偏好', exact: true }).waitFor()

          // 全新 userData 下默认必须是「跟随系统」。
          const defaultTheme = await readStoredTheme(page)
          const defaultValueOnSelect = await page
            .getByTestId(settingsSelectors.themeSelect)
            .innerText()
          const defaultNativeThemeSource = await readNativeThemeSource(runtime.electronApp)

          // 深色：设置页 + 工作台。
          await selectThemeThroughUi(page, 'dark')
          const darkSettings = await readThemeSnapshot(page)
          const darkStored = await readStoredTheme(page)
          const darkNativeThemeSource = await readNativeThemeSource(runtime.electronApp)
          await runtime.captureScreenshot({
            name: 'dark-settings',
            message: '深色主题下的通用设置页'
          })

          await page.evaluate(() => {
            window.location.hash = '#/'
          })
          // 工作台根容器常驻；不依赖具体会话，避免在无伙伴时拿到 hidden 的 composer。
          await page.getByTestId(workbenchSelectors.composerShell).waitFor({ state: 'attached' })
          // 等一帧，确保外壳背景已按主题重算。
          await page.waitForTimeout(800)
          const darkWorkbench = await readThemeSnapshot(page)
          await runtime.captureScreenshot({
            name: 'dark-workbench',
            message: '深色主题下的工作台外壳与输入区'
          })

          // 浅色：确认 CSS 变量真的切回去。
          await navigateToSettingsSection(page, 'general')
          await selectThemeThroughUi(page, 'light')
          const lightSettings = await readThemeSnapshot(page)
          const lightStored = await readStoredTheme(page)
          const lightNativeThemeSource = await readNativeThemeSource(runtime.electronApp)

          // 跟随系统：选项可选，themeSource 交还 system。
          await selectThemeThroughUi(page, 'system')
          const systemStored = await readStoredTheme(page)
          const systemNativeThemeSource = await readNativeThemeSource(runtime.electronApp)

          // 重启后仍然保留，证明落库而非只在渲染层。
          await runtime.restartApp()
          await runtime.page.setViewportSize({ width: 1600, height: 1000 })
          await waitForSettingsAppReady(runtime.page)
          await navigateToSettingsSection(runtime.page, 'general')
          const afterRestartTheme = await readStoredTheme(runtime.page)

          return {
            defaultTheme,
            defaultValueOnSelect,
            defaultNativeThemeSource,
            darkSettings,
            darkStored,
            darkNativeThemeSource,
            darkWorkbench,
            lightSettings,
            lightStored,
            lightNativeThemeSource,
            systemStored,
            systemNativeThemeSource,
            afterRestartTheme
          }
        },
        assert: async (result, runtime) => {
          // SET-GENERAL-007-AC1：三选项可选、默认跟随系统、选择即时生效并持久化。
          await runtime.assertThat(result.defaultTheme === 'system', {
            name: 'appearance-theme-defaults-to-system',
            message: '全新环境默认主题为「跟随系统」',
            data: { defaultTheme: result.defaultTheme, selectText: result.defaultValueOnSelect }
          })
          await runtime.assertThat(
            result.darkStored === 'dark' &&
              result.lightStored === 'light' &&
              result.systemStored === 'system',
            {
              name: 'appearance-theme-persists-selection',
              message: '三个选项均可选，并写入主进程 app_settings',
              data: {
                darkStored: result.darkStored,
                lightStored: result.lightStored,
                systemStored: result.systemStored
              }
            }
          )
          await runtime.assertThat(
            result.darkSettings.dataTheme === 'dark' &&
              result.lightSettings.dataTheme === 'light',
            {
              name: 'appearance-theme-applies-data-attribute',
              message: 'data-theme 随选择即时切换',
              data: {
                dark: result.darkSettings.dataTheme,
                light: result.lightSettings.dataTheme
              }
            }
          )
          await runtime.assertThat(
            result.darkSettings.pageToken.toLowerCase() !==
              result.lightSettings.pageToken.toLowerCase(),
            {
              name: 'appearance-theme-swaps-css-tokens',
              message: 'CSS 变量在明暗之间真实切换',
              data: {
                darkPageToken: result.darkSettings.pageToken,
                lightPageToken: result.lightSettings.pageToken
              }
            }
          )

          // SET-GENERAL-007-AC2：跟随系统时 themeSource 为 system。
          await runtime.assertThat(
            result.darkNativeThemeSource === 'dark' &&
              result.lightNativeThemeSource === 'light' &&
              result.systemNativeThemeSource === 'system',
            {
              name: 'appearance-theme-native-theme-source',
              message: '原生窗口外壳跟随 nativeTheme.themeSource',
              data: {
                defaults: result.defaultNativeThemeSource,
                dark: result.darkNativeThemeSource,
                light: result.lightNativeThemeSource,
                system: result.systemNativeThemeSource
              }
            }
          )

          // SET-GENERAL-007-AC3：深色下主要表面均非白色。
          const brightSurfaces = [
            ...result.darkSettings.surfaces,
            ...result.darkWorkbench.surfaces
          ].filter((surface) => !Number.isNaN(surface.luma) && surface.luma > WHITE_LUMA_THRESHOLD)
          await runtime.assertThat(brightSurfaces.length === 0, {
            name: 'appearance-theme-no-white-surfaces',
            message: '深色主题下设置页与工作台主要表面均非白色',
            data: {
              threshold: WHITE_LUMA_THRESHOLD,
              settingsSurfaces: result.darkSettings.surfaces,
              workbenchSurfaces: result.darkWorkbench.surfaces,
              bright: brightSurfaces
            }
          })

          // 冷启动复用持久化值（选项停在「跟随系统」）。
          await runtime.assertThat(result.afterRestartTheme === 'system', {
            name: 'appearance-theme-survives-restart',
            message: '重启后主题设置保留，不回落为默认以外的值',
            data: { afterRestartTheme: result.afterRestartTheme }
          })
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS * 3
  )
})
