import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'context-ring-usage'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '验证智能模式上下文圆圈会刷新并展示已用与剩余比例。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            createSession: false
          })
          await page.getByRole('button', { name: `在 ${setup.workspaceName} 中新建对话` }).click()
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, '请只回复 ok，用于上下文用量测试。')
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.6)

          const contextRing = getWorkbenchLocator(page, workbenchSelectors.contextRing)
          await contextRing.waitFor({ state: 'visible' })
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('aria-label')
                ?.includes('已用') || false,
            workbenchSelectors.contextRing,
            { timeout: 10_000 }
          )
          const label = (await contextRing.getAttribute('aria-label')) || ''
          await contextRing.hover()
          const tooltipTitle = page.getByText('上下文用量', { exact: true })
          const usedPercent = page.getByText(/^已用 \d+%$/).first()
          await tooltipTitle.waitFor({ state: 'visible', timeout: 3000 })
          await usedPercent.waitFor({ state: 'visible', timeout: 3000 })

          return {
            label,
            tooltipVisible: await tooltipTitle.isVisible(),
            percentVisible: await usedPercent.isVisible(),
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.label.includes('已用') &&
              result.label.includes('剩余') &&
              result.tooltipVisible &&
              result.percentVisible &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-context-ring-usage',
              message:
                '上下文圆圈应在任务后刷新，hover 后展示已用与剩余比例，对齐 WB-COMPOSER-008。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
