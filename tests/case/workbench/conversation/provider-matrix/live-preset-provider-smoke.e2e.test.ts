import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { listConfiguredLiveLlmTargets } from '../../../../harness/core/liveProviders'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  configureLiveModelThroughSettingsUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'live-preset-provider-smoke'
const PARTNER_NAME = '内置服务商冒烟'

const selectPresetModelThroughUi = async (
  page: import('playwright').Page,
  modelName: string
): Promise<string> => {
  const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
  await modelSelect.click()
  const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  await menu.waitFor({ state: 'visible' })
  await menu
    .getByText('正在加载模型目录…', { exact: true })
    .waitFor({ state: 'hidden', timeout: 30_000 })
    .catch(() => undefined)

  const presetOption = menu.getByTestId(
    `${workbenchSelectors.modelSelectPresetOptionPrefix}-${modelName}`
  )
  await presetOption.waitFor({ state: 'visible', timeout: 30_000 })
  const disabled = (await presetOption.getAttribute('aria-disabled')) === 'true'
  if (disabled) {
    throw new Error(`预设模型 ${modelName} 在 UI 中不可用（aria-disabled）`)
  }
  await presetOption.click()
  return (await modelSelect.innerText()).trim()
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['provider-matrix'],
        description:
          'opt-in：对已配置 Key 的每个内置服务商，经 Settings 推荐配置 + Composer 预设选模，真实发送「你好」。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'background',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const targets = listConfiguredLiveLlmTargets()
          if (targets.length === 0) {
            throw new Error(
              'live-preset-provider-smoke 需要至少一个 AI_LIVE_KEY_<PROVIDER>（如 AI_LIVE_KEY_DASHSCOPE）'
            )
          }

          for (const target of targets) {
            await configureLiveModelThroughSettingsUi(page, target)
          }

          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)

          const results: Array<{
            providerId: string
            modelName: string
            selectedLabel: string
            finalAnswerText: string
          }> = []

          for (const target of targets) {
            const selectedLabel = await selectPresetModelThroughUi(page, target.modelName)
            const startedAt = Date.now()
            await sendWorkbenchMessage(page, '你好')
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAt,
              target.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page }
            )
            results.push({
              providerId: target.providerId,
              modelName: target.modelName,
              selectedLabel,
              finalAnswerText: evidence.finalAnswerText
            })
            await runtime.captureScreenshot({
              name: `provider-smoke-${target.providerId}`,
              message: `${target.label} (${target.modelName}) 冒烟完成；选中：${selectedLabel}`
            })
          }

          return {
            expectedProviderIds: targets.map((item) => item.providerId),
            results
          }
        },
        assert: async (result, runtime) => {
          const providerIds = result.results.map((item) => item.providerId)
          await runtime.assertThat(
            result.results.length === result.expectedProviderIds.length &&
              result.expectedProviderIds.every((id) => providerIds.includes(id)) &&
              result.results.every(
                (item) =>
                  item.finalAnswerText.trim().length > 0 && item.selectedLabel.trim().length > 0
              ),
            {
              name: 'live-preset-provider-smoke-ok',
              message:
                '必须经真实 Settings 推荐配置与 Composer 预设 option 选模；每个已配置 Key 的内置服务商都应完成一次「你好」live 回答。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 5
  )
})
