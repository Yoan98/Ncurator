import { describe, it } from 'vitest'
import { USER_MANUAL_URL } from '../../../../../src/shared/constants'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'workbench-help-entry'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '验证 Workbench 左侧使用帮助入口打开官方手册且不改变会话路由。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const helpButton = getWorkbenchLocator(page, workbenchSelectors.settingsHelpButton)
          await helpButton.waitFor({ state: 'visible' })
          const routeBeforeClick = await page.evaluate(() => window.location.hash)
          const accessibleName = (await helpButton.getAttribute('aria-label')) || ''
          await helpButton.click()
          const signals = await runtime.collectSignals()

          return {
            accessibleName,
            routeBeforeClick,
            routeAfterClick: await page.evaluate(() => window.location.hash),
            openExternalCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openExternal'
            )
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.accessibleName === '查看使用帮助' &&
              result.routeAfterClick === result.routeBeforeClick &&
              result.openExternalCalls.some((entry) => entry.payload === USER_MANUAL_URL),
            {
              name: 'workbench-help-entry-opens-official-manual',
              message:
                'Workbench 使用帮助入口应打开官方中文手册，并保持当前会话路由，对齐 WB-COMPOSER-011。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
