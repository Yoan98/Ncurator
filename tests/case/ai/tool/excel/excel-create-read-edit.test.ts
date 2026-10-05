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
        const sourcePath = path.join(runtime.workspaceRoot, 'generated-report.xlsx')
        const recordOf = async (filePath: string) =>
          (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
            (record) => record.path === filePath
          )
        await harness.invoke('excel_edit', {
          type: 'add_sheet',
          sourcePath,
          sheetName: 'Data'
        })
        const created = await harness.invoke<Record<string, unknown>>('excel_edit', {
          type: 'set_range',
          sourcePath,
          sheetName: 'Data',
          range: 'A1:C3',
          values: [
            ['Item', 'Amount', 'Double'],
            ['A', 12, { formula: 'B2*2' }],
            ['B', 8, { formula: 'B3*2' }]
          ]
        })
        const outline = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'workbook',
          sourcePath
        })
        const search = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'search',
          sourcePath,
          query: 'B2*2'
        })
        const read = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'range',
          sourcePath,
          sheetName: 'Data',
          range: 'A1:C3'
        })
        const createdRecordId = (await recordOf(sourcePath))?.id
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath,
          sheetName: 'Data',
          range: 'B2',
          values: [[20]]
        })
        const createdWorkbook = new ExcelJS.Workbook()
        await createdWorkbook.xlsx.load((await fs.readFile(sourcePath)) as never)
        const existingSourcePath = path.join(runtime.workspaceRoot, 'existing-report.xlsx')
        const existingWorkbook = new ExcelJS.Workbook()
        existingWorkbook.addWorksheet('Data').addRows([
          ['Item', 'Amount', 'Double'],
          ['A', 12, { formula: 'B2*2' }],
          ['B', 8, { formula: 'B3*2' }]
        ])
        await fs.writeFile(
          existingSourcePath,
          Buffer.from(await existingWorkbook.xlsx.writeBuffer())
        )
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: existingSourcePath,
          sheetName: 'Data',
          range: 'B2',
          values: [[20]]
        })
        await harness.invoke('excel_edit', {
          type: 'clear_range',
          sourcePath: existingSourcePath,
          sheetName: 'Data',
          range: 'A3'
        })
        const targetPath = existingSourcePath
        const actual = new ExcelJS.Workbook()
        await actual.xlsx.load((await fs.readFile(targetPath)) as never)
        await harness.ctx.finalizeRunFileChanges()
        const previewPath = String((await recordOf(existingSourcePath))?.previewPath || '')
        const diff = new ExcelJS.Workbook()
        await diff.xlsx.load((await fs.readFile(previewPath)) as never)
        return {
          created,
          outline,
          search,
          read,
          actualValue: actual.getWorksheet('Data')?.getCell('B2').value,
          actualFormula: (
            actual.getWorksheet('Data')?.getCell('C2').value as { formula?: string } | undefined
          )?.formula,
          actualHasDiffBorder: Boolean(actual.getWorksheet('Data')?.getCell('B2').border?.left),
          modifiedBorder: diff.getWorksheet('Data')?.getCell('B2').border.left?.color?.argb,
          modifiedBorderStyle: diff.getWorksheet('Data')?.getCell('B2').border.left?.style,
          deletedValueInDiff: diff.getWorksheet('Data')?.getCell('A3').value,
          deletedBorder: diff.getWorksheet('Data')?.getCell('A3').border.left?.color?.argb,
          deletedBorderStyle: diff.getWorksheet('Data')?.getCell('A3').border.left?.style,
          createdSheetNames: createdWorkbook.worksheets.map((sheet) => sheet.name),
          createdRecordId,
          createdUpdatedRecordId: (await recordOf(sourcePath))?.id
        }
      },
      assert: async (result, runtime) => {
        const sheets = result.outline.sheets as Array<{ name: string }> | undefined
        runtime.assertThat(
          result.actualValue === 20 &&
            result.actualFormula === 'B2*2' &&
            result.actualHasDiffBorder === false &&
            result.modifiedBorder === 'FF22A06B' &&
            result.modifiedBorderStyle === 'medium' &&
            result.deletedValueInDiff === 'B' &&
            result.deletedBorder === 'FFD14343' &&
            result.deletedBorderStyle === 'medium' &&
            JSON.stringify(result.createdSheetNames) === JSON.stringify(['Data']) &&
            result.createdRecordId !== undefined &&
            result.createdRecordId === result.createdUpdatedRecordId &&
            JSON.stringify(result.search).includes('C2') &&
            JSON.stringify(result.read).includes('B2*2') &&
            Array.isArray(sheets) &&
            sheets.some((sheet) => sheet.name === 'Data') &&
            Object.keys(result.created).length === 0,
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
