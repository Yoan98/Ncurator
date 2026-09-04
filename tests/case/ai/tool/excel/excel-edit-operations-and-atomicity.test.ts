import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import type { AiRunContext } from '../../../../../src/main/services/ai/types'
import { createExcelToolRuntime } from '../../../../../src/main/services/ai/human/tools/excel/runtime'
import { createExcelToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const loadWorkbook = async (filePath: string): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load((await fs.readFile(filePath)) as never)
  return workbook
}

describe('ai tool excel edit backend', () => {
  it('excel-edit-operations-and-atomicity', async () => {
    await runBackendCase({
      caseId: 'excel-edit-operations-and-atomicity',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      description: '验证 Excel 全编辑操作、no-op、冲突、回滚和累计 baseline。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const writeWorkbook = async (
          fileName: string,
          build: (workbook: ExcelJS.Workbook) => void
        ): Promise<{ filePath: string; bytes: Buffer }> => {
          const workbook = new ExcelJS.Workbook()
          build(workbook)
          const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
          const filePath = path.join(runtime.workspaceRoot, fileName)
          await fs.writeFile(filePath, bytes)
          return { filePath, bytes }
        }

        const operationsFile = await writeWorkbook('operations.xlsx', (workbook) => {
          const deleteMe = workbook.addWorksheet('DeleteMe')
          deleteMe.getCell('A1').value = 'remove'
          deleteMe.getCell('B2').value = 'preserve deleted sheet body'
          deleteMe.getRow(2).height = 32
          deleteMe.getColumn('B').width = 26
          deleteMe.mergeCells('B2:C2')
          deleteMe.getCell('B2').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFCC00' }
          }
          const data = workbook.addWorksheet('Data')
          data.getCell('D2').value = 'clear me'
        })
        await writeWorkbook('noop.xlsx', (workbook) => {
          workbook.addWorksheet('Data').getCell('A1').value = 'same'
        })
        const baselineFile = await writeWorkbook('baseline.xlsx', (workbook) => {
          const sheet = workbook.addWorksheet('Data')
          sheet.getCell('A1').value = 1
          sheet.getCell('B1').value = 10
        })
        const conflictFile = await writeWorkbook('conflict.xlsx', (workbook) => {
          workbook.addWorksheet('Data').getCell('A1').value = 1
        })

        const harness = createExcelToolHarness(runtime)
        const operationsPath = path.join(runtime.workspaceRoot, 'operations.xlsx')
        const recordOf = async (filePath: string) =>
          (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
            (record) => record.path === filePath
          )
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: operationsPath,
          sheetName: 'Data',
          range: 'A1:C3',
          values: [
            ['Item', 'Amount', 'Double'],
            ['A', 12, { formula: 'B2*2' }],
            ['B', 8, { formula: 'B3*2' }]
          ],
          style: {
            bold: true,
            italic: true,
            fontColor: '#FFFFFF',
            fillColor: '#2266AA',
            numberFormat: '0.00',
            horizontalAlignment: 'center',
            verticalAlignment: 'middle'
          }
        })
        await harness.invoke('excel_edit', {
          type: 'clear_range',
          sourcePath: operationsPath,
          sheetName: 'Data',
          range: 'D2'
        })
        await harness.invoke('excel_edit', {
          type: 'add_sheet',
          sourcePath: operationsPath,
          sheetName: 'Summary'
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: operationsPath,
          sheetName: 'Summary',
          range: 'A1',
          values: [['Overview']]
        })
        await harness.invoke('excel_edit', {
          type: 'rename_sheet',
          sourcePath: operationsPath,
          sheetName: 'Summary',
          newName: 'Overview'
        })
        await harness.invoke('excel_edit', {
          type: 'merge_cells',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          range: 'A1:B1'
        })
        await harness.invoke('excel_edit', {
          type: 'set_column_width',
          sourcePath: operationsPath,
          sheetName: 'Data',
          column: 'B',
          width: 24
        })
        await harness.invoke('excel_edit', {
          type: 'insert_rows',
          sourcePath: operationsPath,
          sheetName: 'Data',
          startRow: 2,
          count: 1
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: operationsPath,
          sheetName: 'Data',
          range: 'A2',
          values: [['Inserted']]
        })
        await harness.invoke('excel_edit', {
          type: 'delete_rows',
          sourcePath: operationsPath,
          sheetName: 'Data',
          startRow: 4,
          count: 1
        })
        await harness.invoke('excel_edit', {
          type: 'delete_sheet',
          sourcePath: operationsPath,
          sheetName: 'DeleteMe'
        })
        await harness.invoke('excel_edit', {
          type: 'set_style',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          range: 'A1',
          style: { italic: true }
        })
        await harness.invoke('excel_edit', {
          type: 'set_row_height',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          row: 1,
          height: 22
        })
        await harness.invoke('excel_edit', {
          type: 'auto_fit',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          range: 'A1:B1'
        })
        await harness.invoke('excel_edit', {
          type: 'insert_columns',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          startColumn: 'C',
          count: 1
        })
        await harness.invoke('excel_edit', {
          type: 'delete_columns',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          startColumn: 'C',
          count: 1
        })
        await harness.invoke('excel_edit', {
          type: 'merge_cells',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          range: 'D1:E1'
        })
        await harness.invoke('excel_edit', {
          type: 'unmerge_cells',
          sourcePath: operationsPath,
          sheetName: 'Overview',
          range: 'D1:E1'
        })
        const secondEditRecord = await recordOf(operationsPath)
        const noOp = await harness.invoke<Record<string, unknown>>('excel_edit', {
          type: 'set_range',
          sourcePath: path.join(runtime.workspaceRoot, 'noop.xlsx'),
          sheetName: 'Data',
          range: 'A1',
          values: [['same']]
        })
        const deleteLastSheet = await harness.invoke<Record<string, unknown>>('excel_edit', {
          type: 'delete_sheet',
          sourcePath: path.join(runtime.workspaceRoot, 'noop.xlsx'),
          sheetName: 'Data'
        })
        const baselinePath = path.join(runtime.workspaceRoot, 'baseline.xlsx')
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: baselinePath,
          sheetName: 'Data',
          range: 'A1',
          values: [[2]]
        })
        const baselineFirstId = (await recordOf(baselinePath))?.id
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: baselinePath,
          sheetName: 'Data',
          range: 'B1',
          values: [[20]]
        })
        const conflictPath = path.join(runtime.workspaceRoot, 'conflict.xlsx')
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: conflictPath,
          sheetName: 'Data',
          range: 'A1',
          values: [[2]]
        })
        const external = new ExcelJS.Workbook()
        external.addWorksheet('Data').getCell('A1').value = 99
        await fs.writeFile(conflictFile.filePath, Buffer.from(await external.xlsx.writeBuffer()))
        const conflict = await harness.invoke<Record<string, unknown>>('excel_edit', {
          type: 'set_range',
          sourcePath: conflictPath,
          sheetName: 'Data',
          range: 'A1',
          values: [[3]]
        })

        const rollbackRoot = path.join(runtime.workspaceRoot, 'rollback-scope')
        await fs.mkdir(rollbackRoot, { recursive: true })
        const rollbackWorkbook = new ExcelJS.Workbook()
        rollbackWorkbook.addWorksheet('Data').getCell('A1').value = 'before'
        const rollbackBytes = Buffer.from(await rollbackWorkbook.xlsx.writeBuffer())
        const rollbackPath = path.join(rollbackRoot, 'rollback.xlsx')
        await fs.writeFile(rollbackPath, rollbackBytes)
        const rollbackRuntime = createExcelToolRuntime({
          ctx: {
            checkCancelled: () => undefined,
            sendEvent: () => undefined,
            saveFileChangeRecord: async () => {
              throw new Error('record save failed')
            }
          } as unknown as AiRunContext,
          cache: {},
          runId: `${runtime.runId}-rollback`,
          sessionId: 'rollback-session',
          taskId: `${runtime.taskId}-rollback`,
          workspaceRootPath: rollbackRoot,
          emitActivity: () => undefined
        })
        let rollbackError = ''
        try {
          await rollbackRuntime.edit({
            type: 'set_range',
            sourcePath: rollbackPath,
            sheetName: 'Data',
            range: 'A1',
            values: [['after']]
          })
        } catch (error) {
          rollbackError = error instanceof Error ? error.message : String(error)
        }
        const generatedFiles = async (root: string): Promise<string[]> =>
          await fs
            .readdir(root, { recursive: true })
            .then((items) => items.filter((item) => path.extname(String(item))))
            .catch(() => [])
        const rollback = {
          error: rollbackError,
          sourceRestored: (await fs.readFile(rollbackPath)).equals(rollbackBytes),
          changeArtifacts: await generatedFiles(
            path.join(rollbackRoot, '.ncurator', 'file-changes')
          ),
          legacySnapshotsDirExists: await fs
            .access(path.join(rollbackRoot, '.ncurator', 'file-change-snapshots'))
            .then(() => true)
            .catch(() => false)
        }

        const operations = await loadWorkbook(operationsFile.filePath)
        const operationsDiff = await loadWorkbook(String(secondEditRecord?.previewPath))
        const operationsXml = await JSZip.loadAsync(
          await fs.readFile(operationsFile.filePath)
        ).then((zip) => zip.file('xl/workbook.xml')!.async('text'))
        const baselineRecord = await recordOf(baselinePath)
        const baselineDiff = await loadWorkbook(String(baselineRecord?.previewPath))
        const baselineSource = await loadWorkbook(baselineFile.filePath)

        return {
          firstEdit: {},
          secondEdit: {},
          noOp,
          noOpRecord: await recordOf(path.join(runtime.workspaceRoot, 'noop.xlsx')),
          deleteLastSheet,
          conflict,
          rollback,
          operations: {
            headerFont: operations.getWorksheet('Data')?.getCell('A1').font,
            headerFill: operations.getWorksheet('Data')?.getCell('A1').fill,
            headerNumFmt: operations.getWorksheet('Data')?.getCell('A1').numFmt,
            insertedValue: operations.getWorksheet('Data')?.getCell('A2').value,
            movedValue: operations.getWorksheet('Data')?.getCell('A3').value,
            formula: operations.getWorksheet('Data')?.getCell('C3').value,
            columnWidth: operations.getWorksheet('Data')?.getColumn('B').width,
            merged: operations.getWorksheet('Overview')?.getCell('B1').isMerged,
            deletedSheetMissing: !operations.getWorksheet('DeleteMe'),
            sourceHasDiffBorder: operations.worksheets.some((sheet) => {
              let found = false
              sheet.eachRow((row) =>
                row.eachCell((cell) => {
                  if (
                    cell.border?.left?.color?.argb === 'FF22A06B' ||
                    cell.border?.left?.color?.argb === 'FFD14343'
                  )
                    found = true
                })
              )
              return found
            }),
            diffSheetNames: operationsDiff.worksheets.map((sheet) => sheet.name),
            addedSheetTabColor: operationsDiff.getWorksheet('Overview')?.properties.tabColor?.argb,
            deletedSheetTabColor:
              operationsDiff.getWorksheet('DeleteMe')?.properties.tabColor?.argb,
            deletedSheetValue: operationsDiff.getWorksheet('DeleteMe')?.getCell('A1').value,
            deletedSheetBodyValue: operationsDiff.getWorksheet('DeleteMe')?.getCell('B2').value,
            deletedSheetRowHeight: operationsDiff.getWorksheet('DeleteMe')?.getRow(2).height,
            deletedSheetColumnWidth: operationsDiff.getWorksheet('DeleteMe')?.getColumn('B').width,
            deletedSheetMerged: operationsDiff.getWorksheet('DeleteMe')?.getCell('C2').isMerged,
            deletedSheetFill: operationsDiff.getWorksheet('DeleteMe')?.getCell('B2').fill?.fgColor
              ?.argb,
            deletedSheetBorderStyle: operationsDiff.getWorksheet('DeleteMe')?.getCell('B2').border
              .left?.style,
            dataRedAddresses: (() => {
              const addresses: string[] = []
              operationsDiff.getWorksheet('Data')?.eachRow((row) =>
                row.eachCell({ includeEmpty: true }, (cell) => {
                  if (cell.border?.left?.color?.argb === 'FFD14343') addresses.push(cell.address)
                })
              )
              return addresses
            })(),
            clearRangeValue: operationsDiff.getWorksheet('Data')?.getCell('D3').value,
            clearRangeBorderColor: operationsDiff.getWorksheet('Data')?.getCell('D3').border?.left
              ?.color?.argb,
            clearRangeBorderStyle: operationsDiff.getWorksheet('Data')?.getCell('D3').border?.left
              ?.style,
            fullCalcOnLoad: operationsXml.includes('fullCalcOnLoad="1"')
          },
          baseline: {
            sameRecordId: baselineFirstId === baselineRecord?.id,
            changeCount: baselineRecord?.changeCount,
            originalSnapshot:
              Boolean(baselineRecord?.beforeSnapshotPath) &&
              (await fs.readFile(String(baselineRecord?.beforeSnapshotPath))).equals(
                baselineFile.bytes
              ),
            sourceA1: baselineSource.getWorksheet('Data')?.getCell('A1').value,
            diffA1: baselineDiff.getWorksheet('Data')?.getCell('A1').border.left?.color?.argb,
            diffB1: baselineDiff.getWorksheet('Data')?.getCell('B1').border.left?.color?.argb,
            diffA1Style: baselineDiff.getWorksheet('Data')?.getCell('A1').border.left?.style,
            diffB1Style: baselineDiff.getWorksheet('Data')?.getCell('B1').border.left?.style
          }
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.operations.headerFont.bold === true &&
            result.operations.headerFont.italic === true &&
            result.operations.headerFill.fgColor?.argb === '2266AA' &&
            result.operations.headerNumFmt === '0.00' &&
            result.operations.insertedValue === 'Inserted' &&
            result.operations.movedValue === 'A' &&
            (result.operations.formula as { formula?: string })?.formula === 'B2*2' &&
            result.operations.columnWidth === 24 &&
            result.operations.merged === true &&
            result.operations.deletedSheetMissing === true &&
            result.operations.sourceHasDiffBorder === false &&
            JSON.stringify(result.operations.diffSheetNames) ===
              JSON.stringify(['DeleteMe', 'Data', 'Overview']) &&
            result.operations.addedSheetTabColor === 'FF22A06B' &&
            result.operations.deletedSheetTabColor === 'FFD14343' &&
            result.operations.deletedSheetValue === 'remove' &&
            result.operations.deletedSheetBodyValue === 'preserve deleted sheet body' &&
            result.operations.deletedSheetRowHeight === 32 &&
            result.operations.deletedSheetColumnWidth === 26 &&
            result.operations.deletedSheetMerged === true &&
            result.operations.deletedSheetFill === 'FFFFCC00' &&
            result.operations.deletedSheetBorderStyle === 'medium' &&
            result.operations.clearRangeValue === 'clear me' &&
            result.operations.clearRangeBorderColor === 'FFD14343' &&
            result.operations.clearRangeBorderStyle === 'medium' &&
            result.operations.fullCalcOnLoad === true,
          {
            name: 'excel-all-edit-operations',
            message:
              'Excel 编辑应保留样式并正确执行 Sheet、行、列、合并和公式操作，Diff 应覆盖删除 Sheet 原位置、完整内容和清空范围红色标记。',
            data: result.operations
          }
        )
        runtime.assertThat(Object.keys(result.noOp).length === 0 && !result.noOpRecord, {
            name: 'excel-no-op-has-no-record',
            message: '无变化的 Excel 编辑不能生成修改记录。',
            data: result.noOp
          })
        runtime.assertThat(
          result.deleteLastSheet.error &&
            String(result.deleteLastSheet.error).includes('至少保留一个工作表'),
          {
            name: 'excel-cannot-delete-last-sheet',
            message: 'Excel 不能删除最后一个工作表。',
            data: result.deleteLastSheet
          }
        )
        runtime.assertThat(typeof result.conflict.error === 'string', {
          name: 'excel-external-change-conflict',
          message: '同一 runtime 两轮编辑之间发生外部修改时必须拒绝覆盖。',
          data: result.conflict
        })
        runtime.assertThat(
          result.rollback.error.includes('record save failed') &&
            result.rollback.sourceRestored === true &&
            result.rollback.changeArtifacts.length === 0 &&
            result.rollback.legacySnapshotsDirExists === false,
          {
            name: 'excel-record-persistence-rollback',
            message: '修改记录持久化失败时应恢复源文件并清理 file-changes 下的预览和快照半成品。',
            data: result.rollback
          }
        )
        runtime.assertThat(
          result.baseline.sameRecordId === true &&
            result.baseline.changeCount === 2 &&
            result.baseline.originalSnapshot === true &&
            result.baseline.sourceA1 === 2 &&
            result.baseline.diffA1 === 'FF22A06B' &&
            result.baseline.diffB1 === 'FF22A06B' &&
            result.baseline.diffA1Style === 'medium' &&
            result.baseline.diffB1Style === 'medium',
          {
            name: 'excel-cumulative-first-baseline',
            message: '同一 run 的多轮 Excel 编辑应共用一条记录并相对首个 baseline 生成累计 Diff。',
            data: result.baseline
          }
        )
      }
    })
  })
})
