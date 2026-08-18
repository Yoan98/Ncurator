import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { addBlankSlide, addSlideTextBox, createPresentation, savePresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import { writeRichTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  selectWorkbenchResourceMenuItem,
  selectWorkbenchWorkspace,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'file-preview-external-change-auto-refresh'
const EXTERNAL_CHANGE_NOTICE = '检测到当前文件被外部修改，已自动刷新'
const EXTERNAL_APPLICATION_NOTICE = '如果外部应用仍显示旧内容，请关闭该文档后重新打开。'

const writePptx = async (filePath: string, marker: string): Promise<void> => {
  const presentation = createPresentation()
  const slide = addBlankSlide(presentation)
  addSlideTextBox(slide, {
    x: 1,
    y: 1,
    w: 8,
    h: 1,
    text: marker
  })
  await fs.writeFile(filePath, Buffer.from(await savePresentation(presentation)))
}

const writeXlsx = async (filePath: string, marker: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('外部修改').getCell('A1').value = marker
  await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))
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
          '普通文本、DOCX、PPTX、XLSX 被外部保存后自动刷新，切换或关闭文件后停止旧监听。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        extraEnv: {
          NCURATOR_E2E_OPEN_WITH_NOOP: '1'
        },
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          const markdownPath = path.join(workspace.rootPath, 'external-watch.md')
          const textPath = path.join(workspace.rootPath, 'external-watch.txt')
          const docxPath = path.join(workspace.rootPath, 'external-watch.docx')
          const pptxPath = path.join(workspace.rootPath, 'external-watch.pptx')
          const xlsxPath = path.join(workspace.rootPath, 'external-watch.xlsx')
          await fs.writeFile(markdownPath, '# External Watch\n\noriginal markdown content')
          await fs.writeFile(textPath, 'original text content')
          await writeRichTestDocxFile(workspace.rootPath, 'external-watch.docx', [
            { type: 'paragraph', paragraph: { runs: [{ text: 'original docx content' }] } }
          ])
          await writePptx(pptxPath, 'original pptx content')
          await writeXlsx(xlsxPath, 'original xlsx content')

          const workspaceName = `Workbench ${CASE_ID}`
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName,
            rootPath: workspace.rootPath
          })
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, workspaceName)
          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await selectWorkbenchResourceMenuItem(runtime, 'file')

          const fileFilter = page.getByPlaceholder('筛选文件…')
          await fileFilter.fill('external-watch.md')
          await page.getByTitle('external-watch.md', { exact: true }).click()
          const markdownEditor = getWorkbenchLocator(page, workbenchSelectors.markdownEditor)
          await markdownEditor
            .getByText('original markdown content', { exact: true })
            .waitFor({ timeout: 30_000 })
          await page.waitForFunction(() =>
            Boolean(
              (
                window as unknown as {
                  __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries?: Array<{ name: string }> }
                }
              ).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries?.some(
                (entry) => entry.name === 'fileWatchStart'
              )
            )
          )
          await page.evaluate((noticeText) => {
            const target = window as unknown as {
              __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number
              __NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?: MutationObserver
            }
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ = 0
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?.disconnect()
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__ = new MutationObserver(
              (mutations) => {
                if (
                  mutations.some((mutation) =>
                    [...mutation.addedNodes].some((node) => node.textContent?.includes(noticeText))
                  )
                ) {
                  target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ =
                    (target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0) + 1
                }
              }
            )
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__.observe(document.body, {
              childList: true,
              subtree: true
            })
          }, EXTERNAL_CHANGE_NOTICE)

          await fs.writeFile(markdownPath, '# External Watch\n\nfirst external content')
          await fs.writeFile(markdownPath, '# External Watch\n\nsecond external content')
          await fs.writeFile(markdownPath, '# External Watch\n\nfinal external content')
          await markdownEditor
            .getByText('final external content', { exact: true })
            .waitFor({ timeout: 30_000 })
          await page.waitForTimeout(500)
          const markdownExternalNoticeAbsent =
            (await page.evaluate(
              () =>
                (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                  .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
            )) === 0

          const openWorkspaceFile = async (fileName: string): Promise<void> => {
            if (!(await fileFilter.isVisible().catch(() => false))) {
              await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
              await fileFilter.waitFor({ state: 'visible' })
            }
            await fileFilter.fill(fileName)
            await page.getByTitle(fileName, { exact: true }).click()
          }

          await openWorkspaceFile('external-watch.txt')
          const textEditor = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          await page.waitForFunction(
            (testId) =>
              (document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null)
                ?.value?.includes('original text content'),
            workbenchSelectors.plainTextEditor,
            { timeout: 30_000 }
          )

          await fs.writeFile(markdownPath, '# External Watch\n\nchanged while inactive')
          await page.waitForTimeout(1_000)
          const inactiveFileDidNotRefreshCurrentPreview = await textEditor.evaluate(
            (element) => (element as HTMLTextAreaElement).value.includes('original text content')
          )
          const inactiveFileNoticeAbsent =
            (await page.evaluate(
              () =>
                (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                  .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
            )) === 0

          await page.getByRole('button', { name: '选择打开应用' }).last().click()
          await page
            .locator(`[data-testid^="${workbenchSelectors.openWithApplicationPrefix}-"]`)
            .first()
            .waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await getWorkbenchLocator(page, workbenchSelectors.openWithButton).click()
          await page.waitForTimeout(500)
          const ordinaryOpenHintAbsent =
            (await page.getByText(EXTERNAL_APPLICATION_NOTICE, { exact: true }).count()) === 0

          await openWorkspaceFile('external-watch.docx')
          const docxViewer = getWorkbenchLocator(page, workbenchSelectors.docxViewer)
          await docxViewer.getByText('original docx content', { exact: true }).waitFor({
            timeout: 30_000
          })
          const replacementDocxPath = await writeRichTestDocxFile(
            workspace.rootPath,
            'external-watch-replacement.docx',
            [
              {
                type: 'paragraph',
                paragraph: { runs: [{ text: 'refreshed docx content' }] }
              }
            ]
          )
          const previousDocxPath = path.join(workspace.rootPath, 'external-watch-previous.docx')
          await fs.rename(docxPath, previousDocxPath)
          await fs.rename(replacementDocxPath, docxPath)
          await docxViewer.getByText('refreshed docx content', { exact: true }).waitFor({
            timeout: 30_000
          })
          await page.waitForFunction(
            (expectedCount) =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ === expectedCount,
            1
          )
          const docxRefreshNoticeCount = await page.evaluate(
            () =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
          )

          await openWorkspaceFile('external-watch.pptx')
          const pptViewer = page.getByTestId('ppt-preview-viewer')
          await pptViewer.locator('img').first().waitFor({ state: 'visible', timeout: 30_000 })
          const originalPptImage = await pptViewer.locator('img').first().getAttribute('src')
          await writePptx(pptxPath, 'refreshed pptx content')
          const pptxPreviewRefreshed = await page
            .waitForFunction(
              async ({ originalPptImage, viewerTestId }) => {
                const image = document.querySelector<HTMLImageElement>(
                  `[data-testid="${viewerTestId}"] img`
                )
                if (!image?.src || image.src === originalPptImage) return false
                return (await fetch(image.src).then((response) => response.text())).includes(
                  'refreshed pptx content'
                )
              },
              { originalPptImage, viewerTestId: 'ppt-preview-viewer' },
              { timeout: 30_000 }
            )
            .then(() => true)
            .catch(() => false)
          await page.waitForFunction(
            (expectedCount) =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ === expectedCount,
            docxRefreshNoticeCount + 1
          )
          const pptxRefreshNoticeCount = await page.evaluate(
            () =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
          )

          await openWorkspaceFile('external-watch.xlsx')
          const excelViewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('data-excel-ready') === 'true',
            workbenchSelectors.excelViewer,
            { timeout: 30_000 }
          )
          const originalExcelUri = await excelViewer.getAttribute('data-excel-uri')
          await writeXlsx(xlsxPath, 'refreshed xlsx content')
          const xlsxPreviewRefreshed = await page
            .waitForFunction(
              ({ originalExcelUri, testId }) => {
                const viewer = document.querySelector(`[data-testid="${testId}"]`)
                return (
                  viewer?.getAttribute('data-excel-ready') === 'true' &&
                  Boolean(viewer.getAttribute('data-excel-uri')) &&
                  viewer.getAttribute('data-excel-uri') !== originalExcelUri
                )
              },
              { originalExcelUri, testId: workbenchSelectors.excelViewer },
              { timeout: 30_000 }
            )
            .then(() => true)
            .catch(() => false)
          await page.waitForFunction(
            (expectedCount) =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ === expectedCount,
            pptxRefreshNoticeCount + 1
          )
          const xlsxRefreshNoticeCount = await page.evaluate(
            () =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
          )

          await page.waitForTimeout(600)
          await page.evaluate((noticeText) => {
            const target = window as unknown as {
              __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number
              __NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?: MutationObserver
            }
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ = 0
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?.disconnect()
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__ = new MutationObserver(
              (mutations) => {
                if (
                  mutations.some((mutation) =>
                    [...mutation.addedNodes].some((node) => node.textContent?.includes(noticeText))
                  )
                ) {
                  target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ =
                    (target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0) + 1
                }
              }
            )
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__.observe(document.body, {
              childList: true,
              subtree: true
            })
          }, EXTERNAL_CHANGE_NOTICE)
          await page.getByRole('button', { name: '关闭 external-watch.xlsx' }).click()
          await writeXlsx(xlsxPath, 'changed after tab close')
          await page.waitForTimeout(1_000)
          const closedFileNoticeAbsent =
            (await page.evaluate(
              () =>
                (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                  .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
            )) === 0
          const signals = await runtime.collectSignals()

          return {
            markdownExternalNoticeAbsent,
            inactiveFileDidNotRefreshCurrentPreview,
            inactiveFileNoticeAbsent,
            ordinaryOpenHintAbsent,
            docxRefreshNoticeCount,
            pptxPreviewRefreshed,
            pptxRefreshNoticeCount,
            xlsxPreviewRefreshed,
            xlsxRefreshNoticeCount,
            closedFileNoticeAbsent,
            watchStartCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'fileWatchStart'
            ).length,
            watchStopCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'fileWatchStop'
            ).length,
            openWithCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openFileWithApplication'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.markdownExternalNoticeAbsent &&
              result.inactiveFileDidNotRefreshCurrentPreview &&
              result.inactiveFileNoticeAbsent &&
              result.ordinaryOpenHintAbsent &&
              result.docxRefreshNoticeCount === 1 &&
              result.pptxPreviewRefreshed &&
              result.pptxRefreshNoticeCount === 2 &&
              result.xlsxPreviewRefreshed &&
              result.xlsxRefreshNoticeCount === 3 &&
              result.closedFileNoticeAbsent &&
              result.watchStartCalls >= 5 &&
              result.watchStopCalls >= 5 &&
              result.openWithCalls >= 1,
            {
              name: 'workbench-file-preview-external-change-auto-refresh-real',
              message:
                '普通文本、DOCX、PPTX、XLSX 预览应监听真实磁盘变化并自动刷新；切换或关闭文件后应停止旧监听，普通文件打开外部应用不显示 AI 修改提醒。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
