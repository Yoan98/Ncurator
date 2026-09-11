import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { listConfiguredLiveLlmTargets } from '../../../../harness/core/liveProviders'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  createPartnerThroughWorkbenchUi,
  configureLiveModelThroughSettingsUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'live-preset-provider-smoke'
const PARTNER_NAME = '内置服务商冒烟'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer', 'provider-matrix'],
        description:
          '对 .env 中已配置 Key 的每个内置服务商，走推荐配置 + 默认模型发一句「你好」确认可跑通。',
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
            finalAnswerText: string
          }> = []

          for (const target of targets) {
            await selectWorkbenchModel(page, target.modelName)
            const selectedLabel = (
              await getWorkbenchLocator(page, workbenchSelectors.modelSelect).innerText()
            ).trim()
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
              finalAnswerText: evidence.finalAnswerText
            })
            await runtime.captureScreenshot({
              name: `provider-smoke-${target.providerId}`,
              message: `${target.label} (${target.modelName}) 冒烟完成；选中：${selectedLabel}`
            })
          }

          return { results }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.results.length > 0 &&
              result.results.every((item) => item.finalAnswerText.trim().length > 0),
            {
              name: 'live-preset-provider-smoke-ok',
              message: '每个已配置 Key 的内置服务商都应能完成一次「你好」live 调用。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * 5
  )
})
