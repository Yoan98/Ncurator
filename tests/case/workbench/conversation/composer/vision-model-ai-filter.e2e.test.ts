import { describe, it } from 'vitest'
import type { Locator } from 'playwright'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { createModelConfigThroughSettingsUi } from '../../../../harness/e2e/settings'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  selectWorkbenchModel,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'vision-model-ai-filter'
const MODEL_CONFIG_NAME = 'Live Model'

const waitForVisionResultRows = async (dropdown: Locator, expectedCount: number): Promise<void> => {
  const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  while (Date.now() < deadline) {
    const count = await dropdown.locator('[role="option"]').count()
    if (count >= expectedCount) return
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('vision analysis result options did not appear')
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '验证视觉模型 AI 筛选的分段切换、真实主模型分析返回视觉模型、刷新与独立请求副作用。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'background',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const liveEnv = loadWorkbenchLiveModelEnv()

          await createModelConfigThroughSettingsUi(page, {
            name: MODEL_CONFIG_NAME,
            baseUrl: liveEnv.baseUrl,
            apiKey: liveEnv.apiKey
          })
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await selectWorkbenchModel(page, liveEnv.modelName)

          const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
          await modelSelect.click()
          await page
            .locator('.workbench-select-menu.workbench-composer-menu')
            .last()
            .getByRole('button', { name: /^视觉模型/u })
            .click()
          const dropdown = page.locator('.workbench-select-menu.workbench-composer-menu').last()

          const manualTab = dropdown.getByTestId(workbenchSelectors.modelSelectVisionManualTab)
          const aiTab = dropdown.getByTestId(workbenchSelectors.modelSelectVisionAiTab)
          await manualTab.waitFor({ state: 'visible' })
          const manualSelectedByDefault =
            (await manualTab.getAttribute('aria-selected')) === 'true' &&
            (await dropdown
              .getByRole('option', { name: /跟随主模型/u })
              .isVisible()
              .catch(() => false))

          await aiTab.click()
          const runButton = dropdown.getByTestId(workbenchSelectors.modelSelectVisionAiRun)
          await runButton.waitFor({ state: 'visible' })
          await runtime.captureScreenshot({
            name: 'vision-ai-filter-idle',
            message: '切到 AI 筛选后先展示分析入口，不自动请求。'
          })

          await runButton.click()
          await waitForVisionResultRows(dropdown, 1)
          const firstRowCount = await dropdown.locator('[role="option"]').count()
          await runtime.captureScreenshot({
            name: 'vision-ai-filter-results',
            message: 'AI 筛选真实分析后返回支持视觉的模型。'
          })

          const refreshButton = dropdown.getByTestId(workbenchSelectors.modelSelectVisionAiRefresh)
          await refreshButton.click()
          await waitForVisionResultRows(dropdown, 1)
          const secondRowCount = await dropdown.locator('[role="option"]').count()

          const signals = await runtime.collectSignals()
          const runEventCount = signals.aiRunEventEntries.length

          let selectionClosed = false
          const firstOption = dropdown.locator('[role="option"]').first()
          await firstOption.click()
          selectionClosed = await dropdown.isHidden().catch(() => false)
          await runtime.captureScreenshot({
            name: 'vision-ai-filter-selected',
            message: '点击 AI 筛选结果后选中视觉模型并关闭弹层。'
          })

          return {
            manualSelectedByDefault,
            firstRowCount,
            secondRowCount,
            runEventCount,
            selectionClosed
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.manualSelectedByDefault, {
            name: 'vision-ai-filter-defaults-to-manual',
            message: '视觉模型面板默认选中手动选择，且保留跟随主模型入口。',
            data: { manualSelectedByDefault: result.manualSelectedByDefault }
          })

          await runtime.assertThat(result.firstRowCount > 0, {
            name: 'vision-ai-filter-returns-vision-models',
            message: '点击 AI 分析后真实主模型应返回至少一个支持视觉的模型。',
            data: { firstRowCount: result.firstRowCount }
          })
          await runtime.assertThat(result.secondRowCount > 0, {
            name: 'vision-ai-filter-refresh-updates',
            message: '点击刷新后应重新分析并再次展示视觉模型结果。',
            data: { secondRowCount: result.secondRowCount }
          })
          await runtime.assertThat(result.runEventCount === 0, {
            name: 'vision-ai-filter-is-standalone',
            message: 'AI 筛选请求独立于 human run，不产生任何 AI run 事件。',
            data: { runEventCount: result.runEventCount }
          })
          await runtime.assertThat(result.selectionClosed, {
            name: 'vision-ai-filter-selects-model',
            message: '点击结果项后选中视觉模型并关闭弹层。',
            data: { selectionClosed: result.selectionClosed }
          })
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
