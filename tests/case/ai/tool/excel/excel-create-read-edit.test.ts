import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createExcelToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool excel backend', () => {
  it('excel-create-read-edit', async () => {
    await runBackendCase({
      caseId: 'excel-create-read-edit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      description: '验证 Excel 创建、批量写入、公式、搜索、范围读取和红绿 diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createExcelToolHarness(runtime)
        const sourcePath = 'generated-report.xlsx'
        const created = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath,
          actions: [
            { type: 'add_sheet', sheetName: 'Data' },
            {
              type: 'set_range',
              sheetName: 'Data',
              startCell: 'A1',
              values: [
                ['Item', 'Amount', 'Double'],
                ['A', 12, { formula: 'B2*2' }],
                ['B', 8, { formula: 'B3*2' }]
              ]
            }
          ]
        })
        const outline = await harness.invoke<Record<string, unknown>>('excel_read_outline', {
          sourcePath
        })
        const search = await harness.invoke<Record<string, unknown>>('excel_search', {
          sourcePath,
          query: 'B2*2'
        })
        const read = await harness.invoke<Record<string, unknown>>('excel_read_cells', {
          sourcePath,
          ranges: [{ sheetName: 'Data', range: 'A1:C3' }]
        })
        const createdUpdated = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath,
          actions: [{ type: 'set_cell', sheetName: 'Data', address: 'B2', value: 20 }]
        })
        const createdWorkbook = new ExcelJS.Workbook()
        await createdWorkbook.xlsx.load(
          (await fs.readFile(path.join(runtime.workspaceRoot, sourcePath))) as never
        )
        const existingSourcePath = 'existing-report.xlsx'
        const existingWorkbook = new ExcelJS.Workbook()
        existingWorkbook.addWorksheet('Data').addRows([
          ['Item', 'Amount', 'Double'],
          ['A', 12, { formula: 'B2*2' }],
          ['B', 8, { formula: 'B3*2' }]
        ])
        await fs.writeFile(
          path.join(runtime.workspaceRoot, existingSourcePath),
          Buffer.from(await existingWorkbook.xlsx.writeBuffer())
        )
        const updated = await harness.invoke<Record<string, unknown>>('excel_edit', {
          sourcePath: existingSourcePath,
          actions: [
            { type: 'set_cell', sheetName: 'Data', address: 'B2', value: 20 },
            { type: 'delete_cell', sheetName: 'Data', address: 'A3' }
          ]
        })
        const targetPath = path.join(runtime.workspaceRoot, existingSourcePath)
        const actual = new ExcelJS.Workbook()
        await actual.xlsx.load((await fs.readFile(targetPath)) as never)
        const previewPath = String(
          (updated.record as { previewPath?: string } | undefined)?.previewPath || ''
        )
        const diff = new ExcelJS.Workbook()
        await diff.xlsx.load((await fs.readFile(previewPath)) as never)
        return {
          created,
          outline,
          search,
          read,
          updated,
          actualValue: actual.getWorksheet('Data')?.getCell('B2').value,
          actualFormula: (
            actual.getWorksheet('Data')?.getCell('C2').value as { formula?: string } | undefined
          )?.formula,
          actualHasDiffBorder: Boolean(actual.getWorksheet('Data')?.getCell('B2').border?.left),
          modifiedBorder: diff.getWorksheet('Data')?.getCell('B2').border.left?.color?.argb,
          deletedBorder: diff.getWorksheet('Data')?.getCell('A3').border.left?.color?.argb,
          createdSheetNames: createdWorkbook.worksheets.map((sheet) => sheet.name),
          createdRecordId: (created.record as { id?: string } | undefined)?.id,
          createdUpdatedRecordId: (createdUpdated.record as { id?: string } | undefined)?.id
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.actualValue === 20 &&
            result.actualFormula === 'B2*2' &&
            result.actualHasDiffBorder === false &&
            result.modifiedBorder === 'FF22A06B' &&
            result.deletedBorder === 'FFD14343' &&
            JSON.stringify(result.createdSheetNames) === JSON.stringify(['Data']) &&
            result.createdRecordId !== undefined &&
            result.createdRecordId === result.createdUpdatedRecordId &&
            JSON.stringify(result.search).includes('C2') &&
            JSON.stringify(result.read).includes('B2*2'),
          {
            name: 'excel-dedicated-tools-and-clean-source-diff',
            message: 'Excel 工具应完成读写，实际文件无差异边框，diff 文件按规则显示红绿边框。',
            data: result
          }
        )
      }
    })
  })
})
