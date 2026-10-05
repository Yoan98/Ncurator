import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyRecordStatus,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'excel-update-diff-and-revert'
const FILE_NAME = 'quarterly-data.xlsx'
const EXTERNAL_APPLICATION_NOTICE = '如果外部应用仍显示旧内容，请关闭该文档后重新打开。'

const createBaselineWorkbook = async (filePath: string): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Data')
  sheet.addRows([
    ['Item', 'Amount', 'Double'],
    ['A', 12, { formula: 'B2*2' }],
    ['B', 8, { formula: 'B3*2' }]
  ])
  workbook.addWorksheet('Notes').getCell('A1').value = 'secondary sheet'
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  await fs.writeFile(filePath, bytes)
  return bytes
}

const verifyExcelViewerReadOnly = async (page: Page): Promise<boolean> => {
  const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
  const marker = `EXCEL_DIFF_EDIT_BLOCKED_${Date.now()}`
  const box = await viewer.boundingBox()
  if (!box) return false
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 })
  await page.keyboard.type(marker)
  await page.keyboard.press('Enter')
  const noEditableFocus = await page.evaluate((testId) => {
    const root = document.querySelector(`[data-testid="${testId}"]`)
    const active = document.activeElement
    if (!root || !active || !root.contains(active)) return true
    return !active.matches('input, textarea, [contenteditable="true"]')
  }, workbenchSelectors.excelViewer)
  const markerAbsent = await viewer
    .evaluate((element, text) => !element.textContent?.includes(text), marker)
    .catch(() => false)
  await page.mouse.move(box.x + 95, box.y + 24)
  await page.mouse.down()
  await page.mouse.move(box.x + 135, box.y + 24, { steps: 5 })
  await page.mouse.up()
  const previewStillReady = await viewer.evaluate(
    (element) => element.getAttribute('data-excel-ready') === 'true'
  )
  const canvasStillVisible = (await viewer.locator('canvas').count()) > 0
  return noEditableFocus && markerAbsent && previewStillReady && canvasStillVisible
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 更新 Excel 后，验证单网格红绿 diff、干净实际文件和回撤。',
        fixtures: [],
        serviceMode: 'real',
        extraEnv: {
          NCURATOR_E2E_OPEN_WITH_NOOP: '1'
        },
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const filePath = path.join(setup.workspace.rootPath, FILE_NAME)
          const baselineBytes = await createBaselineWorkbook(filePath)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请读取并直接修改工作区的“${FILE_NAME}”：先把 Data!B2 改为 20；确认第一次修改后，再删除 Data!A3，并在 Data!D1 写入“Checked”；最后核对 Data 和 Notes 两个工作表。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          const actual = new ExcelJS.Workbook()
          const actualBytes = await fs.readFile(filePath)
          await actual.xlsx.load(actualBytes as never)
          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          const waitForExcelReady = async (previousUri?: string | null): Promise<void> => {
            await page.waitForFunction(
              ({ testId, previousUri }) => {
                const element = document.querySelector(`[data-testid="${testId}"]`)
                return (
                  element?.getAttribute('data-excel-ready') === 'true' &&
                  (!previousUri || element.getAttribute('data-excel-uri') !== previousUri)
                )
              },
              { testId: workbenchSelectors.excelViewer, previousUri },
              { timeout: 30_000 }
            )
          }
          await waitForExcelReady()
          const readChangedSheets = async (): Promise<string[]> => {
            const raw = await viewer.getAttribute('data-excel-changed-sheets')
            if (!raw) return []
            const parsed: unknown = JSON.parse(raw)
            return Array.isArray(parsed)
              ? parsed.filter((item): item is string => typeof item === 'string')
              : []
          }
          const sheetTabHasChangeDot = async (sheetName: string): Promise<boolean> =>
            page.evaluate(
              ({ testId, sheetName }) => {
                const root = document.querySelector(`[data-testid="${testId}"]`)
                if (!root) return false
                const tab = Array.from(
                  root.querySelectorAll('[data-u-comp="slide-tab-item"]')
                ).find((item) => item.textContent?.trim() === sheetName)
                if (!tab) return false
                return getComputedStyle(tab, '::after').backgroundColor === 'rgb(34, 160, 107)'
              },
              { testId: workbenchSelectors.excelViewer, sheetName }
            )
          const diffChangedSheets = await readChangedSheets()
          const diffDataTabHasDot = await sheetTabHasChangeDot('Data')
          const diffNotesTabHasDot = await sheetTabHasChangeDot('Notes')
          await getWorkbenchLocator(page, workbenchSelectors.applyOpenSystemButton).click()
          const xlsxOpenWithApplication = page
            .locator(`[data-testid^="${workbenchSelectors.openWithApplicationPrefix}-"]`)
            .first()
          await xlsxOpenWithApplication.waitFor({ state: 'visible', timeout: 10_000 })
          await xlsxOpenWithApplication.click()
          const externalApplicationHintVisible = await page
            .getByText(EXTERNAL_APPLICATION_NOTICE, { exact: true })
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
          const documentModeToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          )
          const documentModeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
          const initialToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const initialModeTag = (await documentModeTag.textContent())?.trim()
          const diffCanvasVisible = (await viewer.locator('canvas').count()) > 0
          const diffReadOnly = await verifyExcelViewerReadOnly(page)
          const diffNotesSheetTab = viewer.getByText('Notes', { exact: true }).last()
          await diffNotesSheetTab.click()
          const diffNotesSheetVisible = await diffNotesSheetTab.isVisible().catch(() => false)
          await viewer.getByText('Data', { exact: true }).last().click()
          const external = new ExcelJS.Workbook()
          await external.xlsx.load(actualBytes as never)
          external.getWorksheet('Data')!.name = 'External C'
          await fs.writeFile(filePath, Buffer.from(await external.xlsx.writeBuffer()))
          const diffUri = await viewer.getAttribute('data-excel-uri')
          await documentModeToggle.click()
          await waitForExcelReady(diffUri)
          const previewExternalCSheetVisible = await viewer
            .getByText('External C', { exact: true })
            .last()
            .isVisible()
          const previewChangedSheets = await readChangedSheets()
          const previewDataTabHasDot = await sheetTabHasChangeDot('Data')
          const fileModeToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const previewModeTag = (await documentModeTag.textContent())?.trim()
          const fileReadOnly = await verifyExcelViewerReadOnly(page)
          const fileNotesSheetTab = viewer.getByText('Notes', { exact: true }).last()
          await fileNotesSheetTab.click()
          const fileModeNotesVisible = await fileNotesSheetTab.isVisible().catch(() => false)
          await viewer.getByText('External C', { exact: true }).last().click()
          const fileUri = await viewer.getAttribute('data-excel-uri')
          await documentModeToggle.click()
          await waitForExcelReady(fileUri)
          const restoredToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const restoredModeTag = (await documentModeTag.textContent())?.trim()
          const reviewRetainsBSheet =
            (await viewer.getByText('Data', { exact: true }).last().isVisible()) &&
            (await viewer.getByText('External C', { exact: true }).count()) === 0
          const pptBeforeAfterVisible =
            (await getWorkbenchLocator(page, workbenchSelectors.pptDiffBefore).count()) > 0 ||
            (await getWorkbenchLocator(page, workbenchSelectors.pptDiffAfter).count()) > 0

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await page.getByText('仍然回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const revertedBytes = await fs.readFile(filePath)

          return {
            previewExternalCSheetVisible,
            reviewRetainsBSheet,
            actualValue: actual.getWorksheet('Data')?.getCell('B2').value,
            actualFormula: (
              actual.getWorksheet('Data')?.getCell('C2').value as { formula?: string } | undefined
            )?.formula,
            deletedValue: actual.getWorksheet('Data')?.getCell('A3').value,
            addedValue: actual.getWorksheet('Data')?.getCell('D1').value,
            actualHasDiffBorder: actual.worksheets.some((sheet) => {
              let found = false
              sheet.eachRow((row) =>
                row.eachCell((cell) => {
                  if (
                    cell.border?.left ||
                    cell.border?.right ||
                    cell.border?.top ||
                    cell.border?.bottom
                  )
                    found = true
                })
              )
              return found
            }),
            externalApplicationHintVisible,
            diffCanvasVisible,
            diffReadOnly,
            diffChangedSheets,
            diffDataTabHasDot,
            diffNotesTabHasDot,
            previewChangedSheets,
            previewDataTabHasDot,
            diffNotesSheetVisible,
            initialToggleLabel,
            fileModeToggleLabel,
            initialModeTag,
            previewModeTag,
            restoredModeTag,
            fileReadOnly,
            restoredToggleLabel,
            fileModeNotesVisible,
            pptBeforeAfterVisible,
            revertedToBaseline: revertedBytes.equals(baselineBytes),
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.actualValue === 20 &&
              result.actualFormula === 'B2*2' &&
              result.deletedValue === null &&
              result.addedValue === 'Checked' &&
              result.actualHasDiffBorder === false &&
              result.externalApplicationHintVisible &&
              result.diffCanvasVisible &&
              result.diffReadOnly &&
              result.diffChangedSheets.includes('Data') &&
              result.diffChangedSheets.includes('Notes') === false &&
              result.diffDataTabHasDot &&
              result.diffNotesTabHasDot === false &&
              result.previewExternalCSheetVisible &&
              result.reviewRetainsBSheet &&
              result.previewChangedSheets.length === 0 &&
              result.previewDataTabHasDot === false &&
              result.diffNotesSheetVisible &&
              result.initialModeTag === '审核' &&
              result.previewModeTag === '预览' &&
              result.restoredModeTag === '审核' &&
              result.initialToggleLabel === '切换到预览模式' &&
              result.fileModeToggleLabel === '切换到审核模式' &&
              result.fileReadOnly &&
              result.restoredToggleLabel === '切换到预览模式' &&
              result.fileModeNotesVisible &&
              result.pptBeforeAfterVisible === false &&
              result.revertedToBaseline &&
              result.toolNames.includes('excel_read') &&
              result.toolNames.filter((name) => name === 'excel_edit').length >= 2,
            {
              name: 'workbench-excel-update-diff-and-revert-real',
              message:
                'Excel 修改应在 Univer 中切换正式工作簿与 Diff 工作簿，实际文件无标记，并能恢复原文件。',
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
