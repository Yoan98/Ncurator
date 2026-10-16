import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase, type E2ETestRuntime } from '../../../../harness/e2e/run-e2e-case'
import {
  copyExcelCell,
  getExcelGridCanvas,
  verifyExcelCellReadOnly
} from '../../../../harness/e2e/excel'
import {
  DEFAULT_WORKSHEET_COLUMN_TITLE_HEIGHT,
  DEFAULT_WORKSHEET_COLUMN_WIDTH,
  DEFAULT_WORKSHEET_ROW_HEIGHT,
  DEFAULT_WORKSHEET_ROW_TITLE_WIDTH
} from '@univerjs/core'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  openWorkbenchWorkspaceFile,
  prepareWorkbenchWorkspaceThroughUi,
  createPartnerThroughWorkbenchUi,
  selectWorkbenchResourceMenuItem,
  setWorkbenchInput,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { isWpsOpenWithApplication } from '../../../../../src/renderer/src/components/workbench/wpsOpenWithHint'

import { WPS_INTEGRATION_MANUAL_URL } from '../../../../../src/shared/constants'

const CASE_ID = 'file-preview-actions'

const setupPreviewWorkspace = async (
  page: Page
): Promise<{
  workspaceName: string
  rootPath: string
  workbookBytes: Buffer
}> => {
  const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
  const workbook = new ExcelJS.Workbook()
  const data = workbook.addWorksheet('Data')
  data.getCell('A1').value = 'excel normal preview fixture'
  data.getCell('B1').value = 10
  data.getCell('B2').value = 20
  data.getCell('C1').value = { formula: 'AVERAGE(B1:B2)' }
  data.getCell('C2').value = { formula: 'SUM(B1:B2)', result: 999 }
  data.getCell('C3').value = { formula: 'B1-10', result: 99 }
  data.getCell('C4').value = { formula: 'Notes!B1+B1' }
  for (let row = 5; row <= 80; row++) data.getCell(`C${row}`).value = `引用行 ${row}`
  const notes = workbook.addWorksheet('Notes')
  notes.getCell('A1').value = 'excel secondary sheet'
  notes.getCell('B1').value = 5
  const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer())
  await Promise.all(
    ['xlsx', 'xlsm', 'xltx', 'xltm'].map(async (extension) => {
      await fs.writeFile(
        path.join(workspace.rootPath, `normal-preview.${extension}`),
        workbookBytes
      )
    })
  )
  const workspaceName = `Workbench ${CASE_ID}`
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName,
    rootPath: workspace.rootPath
  })
  await createPartnerThroughWorkbenchUi(page, workspaceName)
  await navigateToWorkbench(page)
  return {
    workspaceName,
    rootPath: workspace.rootPath,
    workbookBytes
  }
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
  const viewer = getWorkbenchLocator(page, workbenchSelectors.markdownEditor)
  await viewer.waitFor({ state: 'visible', timeout: 30_000 })
  const rendered = await page
    .waitForFunction(
      (testId) => {
        const element = document.querySelector(`[data-testid="${testId}"]`)
        return Boolean(element?.textContent?.includes('Workbench Preview Fixture'))
      },
      workbenchSelectors.markdownEditor,
      { timeout: 30_000 }
    )
    .then(() => true)
    .catch(() => false)
  if (!rendered) return false
  const text = (await viewer.textContent()) || ''
  return (
    text.includes('Workbench Preview Fixture') &&
    text.includes('Markdown table') &&
    text.includes('previewRenderer')
  )
}

const waitForPlainTextPreview = async (page: Page): Promise<boolean> => {
  const viewer = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
  await viewer.waitFor({ state: 'visible', timeout: 30_000 })
  const text = await viewer.inputValue().catch(() => '')
  return text.includes('Hello from human fixture.') && text.includes('workspace read validation')
}

const waitForExcelPreview = async (page: Page, fileName: string): Promise<boolean> => {
  const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
  await viewer.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    ({ testId, fileName }) => {
      const element = document.querySelector(`[data-testid="${testId}"]`)
      return (
        element?.getAttribute('data-excel-ready') === 'true' &&
        element.getAttribute('data-excel-file-name') === fileName
      )
    },
    { testId: workbenchSelectors.excelViewer, fileName },
    { timeout: 30_000 }
  )
  return (await viewer.locator('canvas').count()) > 0
}

const verifyExcelPreviewReadOnly = async (runtime: E2ETestRuntime): Promise<boolean> => {
  const { page } = runtime
  const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
  const cellContentPreserved = await verifyExcelCellReadOnly(runtime, 'B1')
  const box = await viewer.boundingBox()
  if (!box) return false
  const notesTab = viewer.getByText('Notes', { exact: true }).last()
  await notesTab.click()
  const sheetSwitchWorks = await notesTab.isVisible().catch(() => false)
  await viewer.getByText('Data', { exact: true }).last().click()
  await page.mouse.move(box.x + 95, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 135, box.y + 24, { steps: 5 })
  await page.mouse.up()
  const previewStillReady = await viewer.evaluate(
    (element) => element.getAttribute('data-excel-ready') === 'true'
  )
  const canvasStillVisible = (await viewer.locator('canvas').count()) > 0
  return cellContentPreserved && sheetSwitchWorks && previewStillReady && canvasStillVisible
}

const verifyExcelSelectionReference = async (runtime: E2ETestRuntime): Promise<void> => {
  const { page } = runtime
  const canvas = getExcelGridCanvas(page)
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Excel 表格主画布不可见')
  const x = box.x + DEFAULT_WORKSHEET_ROW_TITLE_WIDTH + 2.5 * DEFAULT_WORKSHEET_COLUMN_WIDTH
  const cellY = (row: number) =>
    box.y + DEFAULT_WORKSHEET_COLUMN_TITLE_HEIGHT + (row - 0.5) * DEFAULT_WORKSHEET_ROW_HEIGHT
  await page.mouse.move(x, cellY(17))
  await page.mouse.down()
  await page.mouse.move(x, cellY(20), { steps: 12 })
  await page.mouse.up()
  const popup = page.getByTestId('excel-selection-popup')
  await page.getByTestId('excel-selection-ai-reference').waitFor({ state: 'visible' })
  const popupBox = await popup.boundingBox()
  await runtime.assertThat(
    !!popupBox &&
      popupBox.x >= box.x &&
      popupBox.x + popupBox.width <= box.x + box.width &&
      popupBox.y >= box.y &&
      popupBox.y + popupBox.height <= box.y + box.height,
    {
      name: 'excel-selection-visible-action',
      message: '真实鼠标拖选 C17:C20 后，AI 引用入口在表格预览内可见。',
      data: { canvas: box, popup: popupBox }
    }
  )
  await runtime.captureScreenshot({
    name: 'excel-selection-action',
    message: '多行选区 AI 引用入口'
  })
  await page.getByTestId('excel-selection-ai-reference').click()
  await page.getByTestId('excel-selection-thought').fill('解释这四行，不修改文件。')
  await page.getByTestId('excel-selection-save').click()
  await popup.waitFor({ state: 'detached' })
  const tokens = getWorkbenchLocator(page, workbenchSelectors.input).locator(
    '[data-role="document-selection-token"]'
  )
  await tokens.last().waitFor({ state: 'visible' })
  const title = (await tokens.last().getAttribute('title')) || ''
  await runtime.assertThat(
    (await tokens.count()) === 1 &&
      title.includes('位置：Data!C17:C20') &&
      [17, 18, 19, 20].every((row) => title.includes(`引用行 ${row}`)),
    {
      name: 'excel-selection-composer-reference',
      message: '确认想法后，Composer 保留准确范围和四行内容快照。',
      data: { title }
    }
  )
  await page.mouse.move(x, cellY(10))
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(200)
  await tokens.last().click()
  // Returning to a reference scrolls its starting row and column to the viewport origin.
  await canvas.click({
    position: {
      x: DEFAULT_WORKSHEET_ROW_TITLE_WIDTH + DEFAULT_WORKSHEET_COLUMN_WIDTH / 2,
      y: DEFAULT_WORKSHEET_COLUMN_TITLE_HEIGHT + DEFAULT_WORKSHEET_ROW_HEIGHT / 2
    }
  })
  await page.getByTestId('excel-selection-thought').waitFor({ state: 'visible' })
  await runtime.captureScreenshot({
    name: 'excel-selection-return',
    message: '滚动后从 Composer 回跳编辑引用'
  })
  await popup.getByRole('button', { name: '删除引用' }).click()
  await tokens.waitFor({ state: 'detached' })
  const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
  await viewer.getByText('Notes', { exact: true }).last().click()
  await copyExcelCell(runtime, 'B1')
  await page.getByTestId('excel-selection-ai-reference').waitFor({ state: 'visible' })
  await page.getByTestId('excel-selection-ai-reference').click()
  await page.getByTestId('excel-selection-thought').fill('解释 Notes 单元格。')
  await page.getByTestId('excel-selection-save').click()
  await tokens.last().waitFor({ state: 'visible' })
  const notesTitle = (await tokens.last().getAttribute('title')) || ''
  await runtime.assertThat(notesTitle.includes('位置：Notes!B1'), {
    name: 'excel-selection-sheet-switch',
    message: '切 Sheet 后单格引用入口仍可用，引用记录属于当前工作表。',
    data: { title: notesTitle }
  })
  await tokens.last().click()
  await canvas.click({
    position: {
      x: DEFAULT_WORKSHEET_ROW_TITLE_WIDTH + DEFAULT_WORKSHEET_COLUMN_WIDTH / 2,
      y: DEFAULT_WORKSHEET_COLUMN_TITLE_HEIGHT + DEFAULT_WORKSHEET_ROW_HEIGHT / 2
    }
  })
  await popup.getByRole('button', { name: '删除引用' }).click()
  await tokens.waitFor({ state: 'detached' })
  await viewer.getByText('Data', { exact: true }).last().click()
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

const readWpsHintVisible = async (page: Page): Promise<boolean> =>
  getWorkbenchLocator(page, workbenchSelectors.wpsOpenWithHint)
    .isVisible()
    .catch(() => false)

const readOpenWithHasWps = async (page: Page): Promise<boolean> => {
  await page.getByRole('button', { name: '选择打开应用' }).last().click()
  const items = getWorkbenchPrefixLocator(page, workbenchSelectors.openWithApplicationPrefix)
  await items.first().waitFor({ state: 'visible', timeout: 15_000 })
  const labels = await items.allTextContents()
  await page.keyboard.press('Escape')
  return labels.some((label) => isWpsOpenWithApplication({ name: label }))
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
          '从工作区文件列表打开 pdf/docx/md/txt，验证右侧预览、定位文件、系统打开和 PDF 命中页预览。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await setupPreviewWorkspace(page)
          await openWorkbenchWorkspaceFile(runtime, '学习笔记/深度学习.pdf')
          const pdfPageVisible = await waitForPdfPreviewPage(page)
          await page.getByRole('button', { name: '选择打开应用' }).last().click()
          await page.getByRole('menuitem', { name: '打开所在文件夹' }).last().click()
          const pdfWpsHintVisible = await readWpsHintVisible(page)

          await openWorkbenchWorkspaceFile(runtime, '学习笔记/深度学习.docx')
          const docxViewerVisible = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => true)
            .catch(() => false)
          const docxModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()
          const docxPreviewStableWhileTyping = await verifyDocxPreviewStaysMountedWhileTyping(page)
          const systemOpenVisible = await page
            .getByRole('button', { name: '系统默认打开' })
            .last()
            .isVisible()
            .catch(() => false)
          const docxOpenWithHasWps = await readOpenWithHasWps(page)
          const docxWpsHintVisible = await readWpsHintVisible(page)
          if (docxWpsHintVisible)
            await getWorkbenchLocator(page, workbenchSelectors.wpsOpenWithHint).click()
          await openWorkbenchWorkspaceFile(runtime, 'workbench-preview.md')
          const markdownPreviewVisible = await waitForMarkdownPreview(page)
          const markdownWpsHintVisible = await readWpsHintVisible(page)

          await openWorkbenchWorkspaceFile(runtime, 'human-input.txt')
          const plainTextPreviewVisible = await waitForPlainTextPreview(page)
          const txtWpsHintVisible = await readWpsHintVisible(page)
          const openWithMenuButton = page.getByRole('button', { name: '选择打开应用' }).last()
          await openWithMenuButton.click()
          const openWithApplicationItems = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.openWithApplicationPrefix
          )
          await openWithApplicationItems.first().waitFor({ state: 'visible', timeout: 15_000 })
          const openWithApplicationCount = await openWithApplicationItems.count()
          const visibleOpenWithMenu = page.locator('[role="menu"]:visible').last()
          const openWithMenuHasHorizontalOverflow = await visibleOpenWithMenu.evaluate(
            (element) => element.scrollWidth > element.clientWidth
          )
          const defaultApplicationMarkerVisible = await visibleOpenWithMenu
            .getByText('默认', { exact: true })
            .isVisible()
            .catch(() => false)
          const applicationLabelVisible = await openWithApplicationItems
            .first()
            .evaluate((element) => {
              const name = element.querySelector('span')
              const row = element.closest('[role="menuitem"]')
              if (!name || !row) return false
              const range = document.createRange()
              range.selectNodeContents(name)
              const text = range.getBoundingClientRect()
              const bounds = row.getBoundingClientRect()
              return (
                text.width > 15 &&
                text.height > 0 &&
                text.left >= bounds.left &&
                text.left < bounds.right - 15 &&
                text.top >= bounds.top &&
                text.bottom <= bounds.bottom
              )
            })
          const applicationRowsHaveNoButtons =
            (await openWithApplicationItems.getByRole('button').count()) === 0
          await page.waitForFunction(() =>
            [...document.querySelectorAll('.workbench-open-with-menu')].every((popup) =>
              popup
                .getAnimations({ subtree: true })
                .every((animation) => animation.playState !== 'running')
            )
          )
          const footerEntriesVisible = await visibleOpenWithMenu.evaluate((menu) => {
            const bounds = menu.getBoundingClientRect()
            return ['默认打开应用…', '打开所在文件夹'].every((label) => {
              const row = [...menu.querySelectorAll('[role="menuitem"]')].find(
                (item) => item.textContent?.trim() === label
              )
              if (!row) return false
              const rect = row.getBoundingClientRect()
              return rect.top >= bounds.top && rect.bottom <= bounds.bottom
            })
          })
          await runtime.captureScreenshot({
            name: 'open-with-application-list',
            message: '应用列表只显示生效默认，不显示逐行设置按钮'
          })
          await visibleOpenWithMenu.getByText('默认打开应用…', { exact: true }).click()
          const backToApplications = page.getByRole('button', { name: '返回打开应用列表' })
          await backToApplications.waitFor({ state: 'visible' })
          const settingsHaveNoScopeCaption = !(
            await page.locator('.open-with-popup').innerText()
          ).includes('仅在馆长内生效')
          await runtime.captureScreenshot({
            name: 'open-with-default-settings',
            message: '默认应用选择与打开操作分开，设置页可返回'
          })
          await backToApplications.click()
          await visibleOpenWithMenu.getByText('默认打开应用…', { exact: true }).click()
          await openWithApplicationItems.first().click()
          await backToApplications.waitFor({ state: 'hidden' })
          const preferredAfterSelection = await page.evaluate(
            async (filePath) => {
              const result = await window.api.listOpenWithApplications({ filePath })
              return result.success ? result.preferredApplicationId : undefined
            },
            path.join(workspace.rootPath, 'human-input.txt')
          )
          await visibleOpenWithMenu.getByText('默认打开应用…', { exact: true }).click()
          await visibleOpenWithMenu.getByText('使用系统设置', { exact: true }).click()
          await backToApplications.waitFor({ state: 'hidden' })
          const preferenceCleared = await page.evaluate(
            async (filePath) => {
              const result = await window.api.listOpenWithApplications({ filePath })
              return result.success && !result.preferredApplicationId
            },
            path.join(workspace.rootPath, 'human-input.txt')
          )
          await page.keyboard.press('Escape')
          const resourceTabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
          await resourceTabs.filter({ hasText: 'workbench-preview.md' }).first().click()
          const reopenedMarkdownVisible = await waitForMarkdownPreview(page)
          await selectWorkbenchResourceMenuItem(runtime, 'file')
          const fileLauncherVisible = await page
            .getByText('从右侧工作区文件列表中选择')
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
          const workspaceFileFilterVisible = await page
            .getByPlaceholder('筛选文件…')
            .isVisible()
            .catch(() => false)
          const excelPreviewResults: boolean[] = []
          let excelPreviewReadOnly = false
          let xlsxOpenWithHasWps = false
          let xlsxWpsHintVisible = false
          let xlsmWpsHintVisible = false
          const calculatedValues: string[] = []
          const workspaceFileFilter = page.getByPlaceholder('筛选文件…')
          for (const extension of ['xlsx', 'xlsm', 'xltx', 'xltm']) {
            const fileName = `normal-preview.${extension}`
            if (!(await workspaceFileFilter.isVisible().catch(() => false))) {
              await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
              await workspaceFileFilter.waitFor({ state: 'visible', timeout: 10_000 })
            }
            await workspaceFileFilter.fill(fileName)
            await page.getByTitle(fileName, { exact: true }).click()
            excelPreviewResults.push(await waitForExcelPreview(page, fileName))
            await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
            await workspaceFileFilter.waitFor({ state: 'hidden' })
            if (extension === 'xlsx') {
              for (const address of ['C1', 'C2', 'C3', 'C4'])
                calculatedValues.push(await copyExcelCell(runtime, address))
              excelPreviewReadOnly = await verifyExcelPreviewReadOnly(runtime)
              await verifyExcelSelectionReference(runtime)
              xlsxOpenWithHasWps = await readOpenWithHasWps(page)
              xlsxWpsHintVisible = await readWpsHintVisible(page)
            }
            if (extension === 'xlsm') xlsmWpsHintVisible = await readWpsHintVisible(page)
          }
          const resourceTabCount = await resourceTabs.count()
          const launcherTabCount = await resourceTabs.filter({ hasText: '打开文件' }).count()
          const signals = await runtime.collectSignals()
          const previewPreservedBytes = (
            await fs.readFile(path.join(workspace.rootPath, 'normal-preview.xlsx'))
          ).equals(workspace.workbookBytes)

          return {
            pdfPageVisible,
            pdfWpsHintVisible,
            docxOpenWithHasWps,
            docxWpsHintVisible,
            markdownWpsHintVisible,
            txtWpsHintVisible,
            xlsxOpenWithHasWps,
            xlsxWpsHintVisible,
            xlsmWpsHintVisible,
            docxViewerVisible,
            docxModeTagCount,
            docxPreviewStableWhileTyping,
            wpsManualOpened: signals.ipcInvokeEntries.some(
              (entry) =>
                entry.name === 'openExternal' && entry.payload === WPS_INTEGRATION_MANUAL_URL
            ),
            systemOpenVisible,
            openWithApplicationCount,
            openWithMenuHasHorizontalOverflow,
            defaultApplicationMarkerVisible,
            applicationRowsHaveNoButtons,
            applicationLabelVisible,
            footerEntriesVisible,
            settingsHaveNoScopeCaption,
            preferredAfterSelection,
            preferenceCleared,
            defaultSettingsOpenedFiles: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openFileWithApplication'
            ).length,
            markdownPreviewVisible,
            plainTextPreviewVisible,
            excelPreviewResults,
            excelPreviewReadOnly,
            calculatedValues,
            previewPreservedBytes,
            reopenedMarkdownVisible,
            fileLauncherVisible,
            workspaceFileFilterVisible,
            resourceTabCount,
            launcherTabCount,
            openWithQueryCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'listOpenWithApplications'
            ).length,
            revealPathCalls: signals.ipcInvokeEntries.filter((entry) => entry.name === 'revealPath')
              .length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.pdfPageVisible &&
              result.docxViewerVisible &&
              result.docxModeTagCount === 0 &&
              result.docxPreviewStableWhileTyping &&
              result.systemOpenVisible &&
              result.openWithApplicationCount >= 1 &&
              !result.openWithMenuHasHorizontalOverflow &&
              result.defaultApplicationMarkerVisible &&
              result.applicationRowsHaveNoButtons &&
              result.applicationLabelVisible &&
              result.footerEntriesVisible &&
              result.settingsHaveNoScopeCaption &&
              Boolean(result.preferredAfterSelection) &&
              result.preferenceCleared &&
              result.defaultSettingsOpenedFiles === 0 &&
              result.openWithQueryCalls >= 1 &&
              result.markdownPreviewVisible &&
              result.plainTextPreviewVisible &&
              result.excelPreviewResults.length === 4 &&
              result.excelPreviewResults.every(Boolean) &&
              result.excelPreviewReadOnly &&
              result.reopenedMarkdownVisible &&
              result.fileLauncherVisible &&
              result.workspaceFileFilterVisible &&
              result.resourceTabCount === 8 &&
              result.launcherTabCount === 0 &&
              result.revealPathCalls >= 1 &&
              !result.pdfWpsHintVisible &&
              result.docxWpsHintVisible === result.docxOpenWithHasWps &&
              (!result.docxWpsHintVisible || result.wpsManualOpened) &&
              !result.markdownWpsHintVisible &&
              !result.txtWpsHintVisible &&
              result.xlsxWpsHintVisible === result.xlsxOpenWithHasWps &&
              !result.xlsmWpsHintVisible,
            {
              name: 'workbench-file-preview-actions-real',
              message:
                '右侧普通文件预览应能打开真实 pdf/docx/md/txt/xlsx/xlsm/xltx/xltm，并通过系统关联应用查询提供打开方式下拉和默认标记；docx/xlsx 在打开方式含 WPS 时显示授权问号，其它格式不显示；文件从工作区文件列表打开；从“打开文件”选择器选中文件后选择器 Tab 被文件 Tab 原位替换，不残留。',
              data: result
            }
          )
          await runtime.assertThat(
            result.calculatedValues.every((value) => value.length > 0) &&
              result.calculatedValues.map(Number).join(',') === '15,30,0,15' &&
              result.previewPreservedBytes,
            {
              name: 'excel-preview-forced-formulas',
              message:
                '真实只读网格显示无缓存、过期缓存、零值和跨 Sheet 公式的重算结果，预览不写回源文件。',
              data: {
                values: result.calculatedValues,
                preservedBytes: result.previewPreservedBytes
              }
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
