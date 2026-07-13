import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  switchWorkbenchMode,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'missing-llm-notification-startup'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '无大模型配置时，智能模式首屏应立即提示，搜索模式不提示。',
        fixtures: [],
        runMode: 'repeatable',
        execute: async (runtime) => {
          const { page } = runtime
          const notification = getWorkbenchLocator(
            page,
            workbenchSelectors.llmConfigMissingNotification
          )

          const startedAt = Date.now()
          await notification.waitFor({ state: 'visible', timeout: 1500 })
          const initialVisibleDelayMs = Date.now() - startedAt
          const initialText = ((await notification.textContent()) || '').trim()

          await switchWorkbenchMode(page, '没头脑')
          await notification.waitFor({ state: 'hidden' })
          const hiddenInSearchMode = !(await notification.isVisible().catch(() => false))

          const switchedBackAt = Date.now()
          await switchWorkbenchMode(page, '大聪明')
          await notification.waitFor({ state: 'visible', timeout: 1500 })
          const modeSwitchVisibleDelayMs = Date.now() - switchedBackAt

          return {
            initialVisibleDelayMs,
            modeSwitchVisibleDelayMs,
            initialText,
            hiddenInSearchMode
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.initialVisibleDelayMs < 1500 &&
              result.modeSwitchVisibleDelayMs < 1500 &&
              result.initialText.includes('未配置大模型 API') &&
              result.hiddenInSearchMode,
            {
              name: 'missing-llm-notification-follows-shared-mode-state',
              message:
                '无配置时智能模式应快速显示提示，切到搜索模式应隐藏，切回智能模式应再次快速显示。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
