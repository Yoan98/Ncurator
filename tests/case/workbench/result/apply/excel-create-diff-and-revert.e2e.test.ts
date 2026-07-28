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

const CASE_ID = 'excel-create-diff-and-revert'
const FILE_NAME = 'created-report.xlsx'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 创建 Excel 后，验证全部新增单元格 Diff 和回退删除文件。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const filePath = path.join(setup.workspace.rootPath, FILE_NAME)
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请在工作区新建“${FILE_NAME}”，包含 Data 和 Notes 两个工作表。Data 的 A1:B2 写入 Item/Amount、A/12，Notes 的 A1 写入“created by AI”。完成后核对两个工作表。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(filePath)) as never)

          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          const viewer = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
          await viewer.waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('data-excel-ready') === 'true',
            workbenchSelectors.excelViewer,
            { timeout: 30_000 }
          )
          const diffCanvasVisible = (await viewer.locator('canvas').count()) > 0
          const notesSheetTab = viewer.getByText('Notes', { exact: true }).last()
          await notesSheetTab.click()
          const notesSheetVisible = await notesSheetTab.isVisible().catch(() => false)

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const fileExistsAfterRevert = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)

          return {
            sheetNames: workbook.worksheets.map((sheet) => sheet.name),
            dataValue: workbook.getWorksheet('Data')?.getCell('B2').value,
            notesValue: workbook.getWorksheet('Notes')?.getCell('A1').value,
            diffCanvasVisible,
            notesSheetVisible,
            fileExistsAfterRevert,
            toolNames: evidence.events
              .filter((event) => event.type === 'tool_call_started')
              .map((event) => event.toolName)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.sheetNames.includes('Data') &&
              result.sheetNames.includes('Notes') &&
              result.dataValue === 12 &&
              result.notesValue === 'created by AI' &&
              result.diffCanvasVisible &&
              result.notesSheetVisible &&
              result.fileExistsAfterRevert === false &&
              result.toolNames.includes('excel_edit') &&
              result.toolNames.some((name) => name.startsWith('excel_read')),
            {
              name: 'workbench-excel-create-diff-and-revert-real',
              message:
                '新建 Excel 的 Diff 工作簿应由 Univer 正常渲染，跨 Sheet 可查看，回退后文件应删除。',
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
