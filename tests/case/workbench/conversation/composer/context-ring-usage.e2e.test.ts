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
        description: '验证智能模式上下文圆圈会刷新并展示已用比例与 tokens。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          const partner = (await page.evaluate(() => window.api.partnerList())).find(
            (item) => item.name === setup.workspaceName
          )
          if (!partner) throw new Error('context usage partner missing')
          const before = await page.evaluate(
            (partnerId) => window.api.aiContextUsageGet({ partnerId }),
            partner.id
          )
          if (!before.success) throw new Error('context usage baseline unavailable')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请阅读以下编号，只回复已收到：${Array.from({ length: 160 }, (_, i) => `上下文样本${i}`).join('；')}`
          )
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
          const after = await page.evaluate(
            (partnerId) => window.api.aiContextUsageGet({ partnerId }),
            partner.id
          )
          if (
            !after.success ||
            after.usedContextTokens === undefined ||
            !after.contextWindowTokens
          ) {
            throw new Error('completed context usage unavailable')
          }
          const expectedLabel = `已用 ${Math.max(0, Math.min(100, Math.round((after.ratio || 0) * 100)))}%`
          await page.waitForFunction(
            ({ testId, label }) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-label') ===
              label,
            { testId: workbenchSelectors.contextRing, label: expectedLabel }
          )
          const label = (await contextRing.getAttribute('aria-label')) || ''
          await contextRing.hover()
          const tooltipTitle = page.getByText('上下文用量', { exact: true })
          const usedPercent = page.getByText(/^已用 \d+%$/).first()
          await tooltipTitle.waitFor({ state: 'visible', timeout: 3000 })
          await usedPercent.waitFor({ state: 'visible', timeout: 3000 })
          const expectedTokens = `${after.usedContextTokens.toLocaleString()} / ${after.contextWindowTokens.toLocaleString()} tokens`
          const tokens = page.getByText(expectedTokens, { exact: true })
          await tokens.waitFor({ state: 'visible' })
          const remainingVisible = await page
            .getByText(/^剩余 \d+%$/)
            .first()
            .isVisible()
            .catch(() => false)

          return {
            label,
            beforeTokens: before.usedContextTokens || 0,
            afterTokens: after.usedContextTokens,
            tokenText: await tokens.innerText(),
            expectedTokens,
            tooltipVisible: await tooltipTitle.isVisible(),
            percentVisible: await usedPercent.isVisible(),
            remainingVisible,
            finalAnswerText: evidence.finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.afterTokens > result.beforeTokens &&
              result.tokenText === result.expectedTokens &&
              result.label.includes('已用') &&
              !result.label.includes('剩余') &&
              result.tooltipVisible &&
              result.percentVisible &&
              !result.remainingVisible &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-context-ring-usage',
              message:
                '上下文圆圈应在任务后刷新，hover 后展示已用比例与 tokens、不展示剩余，对齐 WB-COMPOSER-008。',
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
