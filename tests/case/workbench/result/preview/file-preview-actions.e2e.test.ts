import type { Locator, Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  selectWorkbenchWorkspace,
  setWorkbenchInput,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchSearchResults,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'file-preview-actions'

const setupPreviewWorkspace = async (
  page: Page
): Promise<{
  workspaceName: string
  cleanup: () => Promise<void>
}> => {
  const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
  const workspaceName = `Workbench ${CASE_ID}`
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName,
    rootPath: workspace.rootPath
  })
  await navigateToWorkbench(page)
  await selectWorkbenchWorkspace(page, workspaceName)
  return {
    workspaceName,
    cleanup: workspace.cleanup
  }
}

const openSearchPreview = async (page: Page, results: Locator, fileName: string): Promise<void> => {
  await results
    .locator('div')
    .filter({ hasText: fileName })
    .first()
    .getByRole('button', { name: '预览文件' })
    .click()
  await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({ state: 'visible' })
}

const waitForPdfPreviewPage = async (page: Page): Promise<boolean> => {
  const documentView = getWorkbenchLocator(page, workbenchSelectors.documentView)
  await documentView.waitFor({ state: 'visible' })
  return await page
    .waitForFunction(
      (testId) => {
        const root = document.querySelector(`[data-testid="${testId}"]`)
        return Boolean(root?.querySelector('[data-pdf-page]'))
      },
      workbenchSelectors.documentView,
      { timeout: 30_000 }
    )
    .then(() => true)
    .catch(() => false)
}

const waitForMarkdownPreview = async (page: Page): Promise<boolean> => {
  const viewer = getWorkbenchLocator(page, workbenchSelectors.markdownViewer)
  await viewer.waitFor({ state: 'visible', timeout: 30_000 })
  const text = (await viewer.textContent()) || ''
  return (
    text.includes('Workbench Preview Fixture') &&
    text.includes('Markdown table') &&
    text.includes('previewRenderer')
  )
}

const waitForPlainTextPreview = async (page: Page): Promise<boolean> => {
  const viewer = getWorkbenchLocator(page, workbenchSelectors.plainTextViewer)
  await viewer.waitFor({ state: 'visible', timeout: 30_000 })
  const text = (await viewer.textContent()) || ''
  return text.includes('Hello from human fixture.') && text.includes('workspace read validation')
}

const verifyDocxPreviewStaysMountedWhileTyping = async (page: Page): Promise<boolean> => {
  await page.evaluate((testId) => {
    const target = window as unknown as {
      __workbenchDocxViewerRemoved?: boolean
      __workbenchDocxViewerObserver?: MutationObserver
    }
    target.__workbenchDocxViewerRemoved = false
    target.__workbenchDocxViewerObserver?.disconnect()
    target.__workbenchDocxViewerObserver = new MutationObserver(() => {
      if (!document.querySelector(`[data-testid="${testId}"]`)) {
        target.__workbenchDocxViewerRemoved = true
      }
    })
    target.__workbenchDocxViewerObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
  }, workbenchSelectors.docxViewer)

  await getWorkbenchLocator(page, workbenchSelectors.input).click()
  await page.keyboard.type(' preview stability', { delay: 20 })
  await page.waitForTimeout(500)

  const viewerWasRemoved = await page.evaluate(() => {
    const target = window as unknown as {
      __workbenchDocxViewerRemoved?: boolean
      __workbenchDocxViewerObserver?: MutationObserver
    }
    target.__workbenchDocxViewerObserver?.disconnect()
    return Boolean(target.__workbenchDocxViewerRemoved)
  })
  const viewerStillVisible = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
    .isVisible()
    .catch(() => false)
  await setWorkbenchInput(page, '')
  return !viewerWasRemoved && viewerStillVisible
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
          '从真实搜索结果打开 pdf/docx/md/txt，验证右侧预览、定位文件、系统打开和 PDF 命中页预览。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupPreviewWorkspace(page)
          try {
            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, '深度学习.pdf')
            await appendWorkbenchInputText(page, '反走样')
            await submitWorkbenchCurrentDraft(page)
            const pdfResults = await waitForWorkbenchSearchResults(page)
            await openSearchPreview(page, pdfResults, '深度学习.pdf')
            const pdfPageVisible = await waitForPdfPreviewPage(page)
            await page.getByRole('button', { name: '定位到系统位置' }).last().click()

            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, '深度学习.docx')
            await appendWorkbenchInputText(page, '过拟合')
            await submitWorkbenchCurrentDraft(page)
            const docxResults = await waitForWorkbenchSearchResults(page)
            await openSearchPreview(page, docxResults, '深度学习.docx')
            const docxViewerVisible = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
              .waitFor({ state: 'visible', timeout: 30_000 })
              .then(() => true)
              .catch(() => false)
            const docxModeTagCount = await getWorkbenchLocator(
              page,
              workbenchSelectors.documentPreviewModeTag
            ).count()
            const docxPreviewStableWhileTyping =
              await verifyDocxPreviewStaysMountedWhileTyping(page)
            await page.getByRole('button', { name: '系统默认打开' }).last().click()

            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, 'workbench-preview.md')
            await appendWorkbenchInputText(page, 'cedar-markdown-preview-442')
            await submitWorkbenchCurrentDraft(page)
            const markdownResults = await waitForWorkbenchSearchResults(page)
            await openSearchPreview(page, markdownResults, 'workbench-preview.md')
            const markdownPreviewVisible = await waitForMarkdownPreview(page)

            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, 'human-input.txt')
            await appendWorkbenchInputText(page, 'workspace read validation')
            await submitWorkbenchCurrentDraft(page)
            const textResults = await waitForWorkbenchSearchResults(page)
            await openSearchPreview(page, textResults, 'human-input.txt')
            const plainTextPreviewVisible = await waitForPlainTextPreview(page)
            const resourceTabs = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.resourceTabPrefix
            )
            const resourceTabCount = await resourceTabs.count()
            await resourceTabs.filter({ hasText: 'workbench-preview.md' }).first().click()
            const reopenedMarkdownVisible = await waitForMarkdownPreview(page)
            await getWorkbenchLocator(page, workbenchSelectors.resourceTabAddButton).click()
            await page.getByRole('menuitem', { name: '打开文件' }).click()
            const fileLauncherVisible = await page
              .getByText('从右侧工作区文件列表中选择')
              .waitFor({ state: 'visible', timeout: 10_000 })
              .then(() => true)
              .catch(() => false)
            const workspaceFileFilterVisible = await page
              .getByPlaceholder('筛选文件…')
              .isVisible()
              .catch(() => false)
            const signals = await runtime.collectSignals()

            return {
              pdfPageVisible,
              docxViewerVisible,
              docxModeTagCount,
              docxPreviewStableWhileTyping,
              markdownPreviewVisible,
              plainTextPreviewVisible,
              reopenedMarkdownVisible,
              fileLauncherVisible,
              workspaceFileFilterVisible,
              resourceTabCount,
              revealPathCalls: signals.ipcInvokeEntries.filter(
                (entry) => entry.name === 'revealPath'
              ).length
            }
          } finally {
            await setup.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.pdfPageVisible &&
              result.docxViewerVisible &&
              result.docxModeTagCount === 0 &&
              result.docxPreviewStableWhileTyping &&
              result.markdownPreviewVisible &&
              result.plainTextPreviewVisible &&
              result.reopenedMarkdownVisible &&
              result.fileLauncherVisible &&
              result.workspaceFileFilterVisible &&
              result.resourceTabCount === 4 &&
              result.revealPathCalls >= 1,
            {
              name: 'workbench-file-preview-actions-real',
              message:
                '右侧普通文件预览应能打开真实 pdf/docx/md/txt，并提供定位文件和系统打开入口；PDF 预览应显示页面，md/txt 应来自真实索引搜索命中，对齐 WB-PANEL-003-AC1、WB-PANEL-003-AC3。',
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
