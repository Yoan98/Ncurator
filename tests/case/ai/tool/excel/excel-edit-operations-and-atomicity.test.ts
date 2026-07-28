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
          workbook.addWorksheet('Data')
          workbook.addWorksheet('DeleteMe').getCell('A1').value = 'remove'
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
        const firstEdit = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'operations.xlsx',
          actions: [
            {
              type: 'set_range',
              sheetName: 'Data',
              startCell: 'A1',
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
            },
            { type: 'clear_range', sheetName: 'Data', range: 'C3' },
            { type: 'add_sheet', sheetName: 'Summary' },
            { type: 'set_cell', sheetName: 'Summary', address: 'A1', value: 'Overview' }
          ]
        })
        const secondEdit = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'operations.xlsx',
          actions: [
            { type: 'rename_sheet', sheetName: 'Summary', newName: 'Overview' },
            { type: 'merge_cells', sheetName: 'Overview', range: 'A1:B1' },
            { type: 'set_column_width', sheetName: 'Data', column: 'B', width: 24 },
            { type: 'insert_rows', sheetName: 'Data', startRow: 2, count: 1 },
            { type: 'set_cell', sheetName: 'Data', address: 'A2', value: 'Inserted' },
            { type: 'delete_rows', sheetName: 'Data', startRow: 4, count: 1 },
            { type: 'delete_sheet', sheetName: 'DeleteMe' }
          ]
        })
        const noOp = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'noop.xlsx',
          actions: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 'same' }]
        })
        const deleteLastSheet = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'noop.xlsx',
          actions: [{ type: 'delete_sheet', sheetName: 'Data' }]
        })
        const baselineFirst = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'baseline.xlsx',
          actions: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 2 }]
        })
        const baselineSecond = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'baseline.xlsx',
          actions: [{ type: 'set_cell', sheetName: 'Data', address: 'B1', value: 20 }]
        })
        await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'conflict.xlsx',
          actions: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 2 }]
        })
        const external = new ExcelJS.Workbook()
        external.addWorksheet('Data').getCell('A1').value = 99
        await fs.writeFile(conflictFile.filePath, Buffer.from(await external.xlsx.writeBuffer()))
        const conflict = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: 'conflict.xlsx',
          actions: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 3 }]
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
            sourcePath: 'rollback.xlsx',
            actions: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 'after' }]
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
          snapshots: await generatedFiles(
            path.join(rollbackRoot, '.ncurator', 'file-change-snapshots')
          )
        }

        const operations = await loadWorkbook(operationsFile.filePath)
        const operationsDiff = await loadWorkbook(
          String((secondEdit.record as { previewPath?: string } | undefined)?.previewPath)
        )
        const operationsXml = await JSZip.loadAsync(
          await fs.readFile(operationsFile.filePath)
        ).then((zip) => zip.file('xl/workbook.xml')!.async('text'))
        const baselineRecord = baselineSecond.record as
          | { id?: string; previewPath?: string; beforeSnapshotPath?: string; changeCount?: number }
          | undefined
        const baselineDiff = await loadWorkbook(String(baselineRecord?.previewPath))
        const baselineSource = await loadWorkbook(baselineFile.filePath)

        return {
          firstEdit,
          secondEdit,
          noOp,
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
            addedSheetTabColor: operationsDiff.getWorksheet('Overview')?.properties.tabColor?.argb,
            deletedSheetTabColor:
              operationsDiff.getWorksheet('DeleteMe')?.properties.tabColor?.argb,
            deletedSheetValue: operationsDiff.getWorksheet('DeleteMe')?.getCell('A1').value,
            fullCalcOnLoad: operationsXml.includes('fullCalcOnLoad="1"')
          },
          baseline: {
            sameRecordId:
              (baselineFirst.record as { id?: string } | undefined)?.id === baselineRecord?.id,
            changeCount: baselineRecord?.changeCount,
            originalSnapshot:
              Boolean(baselineRecord?.beforeSnapshotPath) &&
              (await fs.readFile(String(baselineRecord?.beforeSnapshotPath))).equals(
                baselineFile.bytes
              ),
            sourceA1: baselineSource.getWorksheet('Data')?.getCell('A1').value,
            diffA1: baselineDiff.getWorksheet('Data')?.getCell('A1').border.left?.color?.argb,
            diffB1: baselineDiff.getWorksheet('Data')?.getCell('B1').border.left?.color?.argb
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
            result.operations.addedSheetTabColor === 'FF22A06B' &&
            result.operations.deletedSheetTabColor === 'FFD14343' &&
            result.operations.deletedSheetValue === 'remove' &&
            result.operations.fullCalcOnLoad === true,
          {
            name: 'excel-all-edit-operations',
            message: 'Excel 编辑应保留样式并正确执行 Sheet、行、列、合并和公式操作。',
            data: result.operations
          }
        )
        runtime.assertThat(
          result.noOp.changed === false &&
            Array.isArray(result.noOp.changes) &&
            result.noOp.changes.length === 0 &&
            !result.noOp.record,
          {
            name: 'excel-no-op-has-no-record',
            message: '无变化的 Excel 编辑不能生成修改记录。',
            data: result.noOp
          }
        )
        runtime.assertThat(
          result.deleteLastSheet.ok === false &&
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
            result.rollback.snapshots.length === 0,
          {
            name: 'excel-record-persistence-rollback',
            message: '修改记录持久化失败时应恢复源文件并清理预览和快照半成品。',
            data: result.rollback
          }
        )
        runtime.assertThat(
          result.baseline.sameRecordId === true &&
            result.baseline.changeCount === 2 &&
            result.baseline.originalSnapshot === true &&
            result.baseline.sourceA1 === 2 &&
            result.baseline.diffA1 === 'FF22A06B' &&
            result.baseline.diffB1 === 'FF22A06B',
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
