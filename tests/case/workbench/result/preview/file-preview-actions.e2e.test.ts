import type { Locator, Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  setupWorkbenchWorkspaceOnly,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchSearchResults,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'file-preview-actions'

const openSearchPreview = async (page: Page, results: Locator, fileName: string): Promise<void> => {
  await results
    .locator('div')
    .filter({ hasText: fileName })
    .first()
    .getByRole('button', { name: '预览文件' })
    .click()
  await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({ state: 'visible' })
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description:
          '从真实搜索结果打开 pdf/docx，验证右侧预览、定位文件、系统打开和 PDF 命中页预览。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWorkspaceOnly(page, { caseId: CASE_ID })
          try {
            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, '深度学习.pdf')
            await appendWorkbenchInputText(page, '反走样')
            await submitWorkbenchCurrentDraft(page)
            const pdfResults = await waitForWorkbenchSearchResults(page)
            await openSearchPreview(page, pdfResults, '深度学习.pdf')
            const pdfPageVisible = await getWorkbenchLocator(page, workbenchSelectors.documentView)
              .locator('[data-pdf-page]')
              .first()
              .isVisible()
              .catch(() => false)
            await page.getByRole('button', { name: '定位文件' }).last().click()

            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, '深度学习.docx')
            await appendWorkbenchInputText(page, '过拟合')
            await submitWorkbenchCurrentDraft(page)
            const docxResults = await waitForWorkbenchSearchResults(page)
            await openSearchPreview(page, docxResults, '深度学习.docx')
            const docxViewerVisible = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
              .isVisible()
              .catch(() => false)
            await page.getByRole('button', { name: '系统打开' }).last().click()
            const signals = await runtime.collectSignals()

            return {
              pdfPageVisible,
              docxViewerVisible,
              revealPathCalls: signals.ipcInvokeEntries.filter(
                (entry) => entry.name === 'revealPath'
              ).length
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.pdfPageVisible && result.docxViewerVisible && result.revealPathCalls >= 1,
            {
              name: 'workbench-file-preview-actions-real',
              message:
                '右侧普通文件预览应能打开真实 pdf/docx，并提供定位文件和系统打开入口；PDF 预览应显示页面，对齐 WB-PANEL-003-AC1、WB-PANEL-003-AC3。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
})
