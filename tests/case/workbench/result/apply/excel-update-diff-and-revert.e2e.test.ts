import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
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
            `请读取并直接修改工作区的“${FILE_NAME}”：把 Data!B2 改为 20，删除 Data!A3，并在 Data!D1 写入“Checked”。只使用 Excel 专用工具完成读写。`
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
          const readCellBorderColor = async (address: string): Promise<string> =>
            await viewer
              .locator(`[data-cell-address="${address}"]`)
              .evaluate((cell) => getComputedStyle(cell).borderColor)
          const modifiedBorderColor = await readCellBorderColor('B2')
          const deletedBorderColor = await readCellBorderColor('A3')
          const addedBorderColor = await readCellBorderColor('D1')
          await viewer.getByRole('button', { name: 'Notes' }).click()
          await runtime.assertThat(
            (await getWorkbenchLocator(page, workbenchSelectors.excelGrid).textContent())?.includes(
              'secondary sheet'
            ) === true,
            {
              name: 'workbench-excel-sheet-switch',
              message: 'Excel 预览应支持切换多个工作表。'
            }
          )
          await viewer.getByRole('button', { name: 'Data' }).click()
          const pptBeforeAfterVisible =
            (await getWorkbenchLocator(page, workbenchSelectors.pptDiffBefore).count()) > 0 ||
            (await getWorkbenchLocator(page, workbenchSelectors.pptDiffAfter).count()) > 0

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const revertedBytes = await fs.readFile(filePath)

          return {
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
            modifiedBorderColor,
            deletedBorderColor,
            addedBorderColor,
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
              result.modifiedBorderColor.includes('34, 160, 107') &&
              result.addedBorderColor.includes('34, 160, 107') &&
              result.deletedBorderColor.includes('209, 67, 67') &&
              result.pptBeforeAfterVisible === false &&
              result.revertedToBaseline &&
              result.toolNames.includes('excel_read_outline') &&
              result.toolNames.includes('excel_edit'),
            {
              name: 'workbench-excel-update-diff-and-revert-real',
              message: 'Excel 修改应显示单网格红绿边框，实际文件无标记，并能恢复原文件。',
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
