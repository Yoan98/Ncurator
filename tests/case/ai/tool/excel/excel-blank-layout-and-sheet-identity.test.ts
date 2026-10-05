import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it, expect } from 'vitest'
import { createExcelToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const load = async (file: string) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load((await fs.readFile(file)) as never)
  return workbook
}
describe('Excel confirmed structure review', () => {
  it('excel-blank-layout-and-sheet-identity', async () => {
    await runBackendCase({
      caseId: 'excel-blank-layout-and-sheet-identity',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      harnessMode: 'tool-real',
      fixtures: [],
      runMode: 'single',
      description: '列对齐、空白布局、合并变换、runtime 重建与同名 Sheet 身份的真实文件和审核。',
      execute: async (runtime) => {
        const source = path.join(runtime.workspaceRoot, 'columns.xlsx'),
          layout = path.join(runtime.workspaceRoot, 'blank.xlsx'),
          sheets = path.join(runtime.workspaceRoot, 'sheets.xlsx'),
          restored = path.join(runtime.workspaceRoot, 'restored.xlsx')
        const original = new ExcelJS.Workbook(),
          data = original.addWorksheet('Data')
        data.addRow(['L', 'M', 'R'])
        data.mergeCells('A3:C4')
        data.getCell('A3').value = 'merged'
        await fs.writeFile(source, Buffer.from(await original.xlsx.writeBuffer()))
        const blank = new ExcelJS.Workbook()
        blank.addWorksheet('Blank')
        await fs.writeFile(layout, Buffer.from(await blank.xlsx.writeBuffer()))
        await fs.writeFile(restored, Buffer.from(await original.xlsx.writeBuffer()))
        const sheetBook = new ExcelJS.Workbook()
        sheetBook.addWorksheet('Data').getCell('A1').value = 'Old Data'
        sheetBook.addWorksheet('Keep').getCell('A1').value = 'Keep'
        sheetBook.addWorksheet('Data（已删除）').getCell('A1').value = 'Reserved name'
        await fs.writeFile(sheets, Buffer.from(await sheetBook.xlsx.writeBuffer()))
        let harness = createExcelToolHarness(runtime)
        await harness.invoke('excel_edit', {
          sourcePath: source,
          type: 'delete_columns',
          sheetName: 'Data',
          startColumn: 'B',
          count: 1
        })
        const saved = await load(source)
        expect(saved.getWorksheet('Data')!.getCell('B1').value).toBe('R')
        expect(saved.getWorksheet('Data')!.model.merges).toEqual(['A3:B4'])
        await harness.invoke('excel_edit', {
          sourcePath: layout,
          type: 'set_style',
          sheetName: 'Blank',
          range: 'C3',
          style: { fillColor: '#FFFF00', bold: true }
        })
        expect((await load(layout)).getWorksheet('Blank')!.getCell('C3').font.bold).toBe(true)
        await harness.invoke('excel_edit', {
          sourcePath: layout,
          type: 'set_column_width',
          sheetName: 'Blank',
          column: 'D',
          width: 24
        })
        await harness.invoke('excel_edit', {
          sourcePath: layout,
          type: 'set_row_height',
          sheetName: 'Blank',
          row: 4,
          height: 32
        })
        await harness.invoke('excel_edit', {
          sourcePath: layout,
          type: 'merge_cells',
          sheetName: 'Blank',
          range: 'A5:B6'
        })
        await harness.invoke('excel_edit', {
          sourcePath: sheets,
          type: 'rename_sheet',
          sheetName: 'Data',
          newName: 'Renamed'
        })
        harness = createExcelToolHarness(runtime)
        await harness.invoke('excel_edit', {
          sourcePath: sheets,
          type: 'set_range',
          sheetName: 'Renamed',
          range: 'B1',
          values: [['New field']]
        })
        await harness.invoke('excel_edit', {
          sourcePath: sheets,
          type: 'delete_sheet',
          sheetName: 'Renamed'
        })
        await harness.invoke('excel_edit', {
          sourcePath: sheets,
          type: 'add_sheet',
          sheetName: 'Data'
        })
        await harness.invoke('excel_edit', {
          sourcePath: sheets,
          type: 'set_range',
          sheetName: 'Data',
          range: 'A1',
          values: [['New Data']]
        })
        await harness.invoke('excel_edit', {
          sourcePath: restored,
          type: 'set_range',
          sheetName: 'Data',
          range: 'A1',
          values: [['B']]
        })
        await harness.invoke('excel_edit', {
          sourcePath: restored,
          type: 'set_range',
          sheetName: 'Data',
          range: 'A1',
          values: [['L']]
        })
        expect(
          (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).every(
            (record) => !record.previewPath
          )
        ).toBe(true)
        const records = await harness.ctx.finalizeRunFileChanges()
        expect(records.some((record) => record.path === restored)).toBe(false)
        const columnReview = await load(
          records.find((record) => record.path === source)!.previewPath!
        )
        const reviewed = columnReview.getWorksheet('Data')!
        expect([1, 2, 3].map((col) => reviewed.getCell(1, col).value)).toEqual(['L', 'M', 'R'])
        expect(reviewed.getCell('B1').border.left?.color?.argb).toBe('FFD14343')
        expect(reviewed.getCell('C1').border?.left?.color?.argb).not.toBe('FF22A06B')
        const layoutReview = (
          await load(records.find((record) => record.path === layout)!.previewPath!)
        ).getWorksheet('Blank')!
        expect(layoutReview.getCell('C3').font.bold).toBe(true)
        expect(layoutReview.getCell('C3').border.left?.color?.argb).toBe('FF22A06B')
        expect(layoutReview.getColumn('D').width).toBe(24)
        expect(layoutReview.getCell('D1').border.left?.color?.argb).toBe('FF22A06B')
        expect(layoutReview.getRow(4).height).toBe(32)
        expect(layoutReview.getCell('A4').border.left?.color?.argb).toBe('FF22A06B')
        expect(layoutReview.model.merges).toContain('A5:B6')
        expect(layoutReview.getCell('A5').border.left?.color?.argb).toBe('FF22A06B')
        const sheetReview = await load(
          records.find((record) => record.path === sheets)!.previewPath!
        )
        expect(sheetReview.getWorksheet('Data（已删除2）')!.getCell('A1').value).toBe('Old Data')
        expect(sheetReview.getWorksheet('Data（已删除）')!.getCell('A1').value).toBe(
          'Reserved name'
        )
        expect(
          sheetReview.getWorksheet('Data（已删除2）')!.getCell('A1').border.left?.color?.argb
        ).toBe('FFD14343')
        expect(sheetReview.getWorksheet('Data')!.getCell('A1').value).toBe('New Data')
        expect(sheetReview.getWorksheet('Data')!.getCell('A1').border.left?.color?.argb).toBe(
          'FF22A06B'
        )
        expect(sheetReview.getWorksheet('Keep')!.properties.tabColor).toBeUndefined()
        runtime.assertThat(true, {
          name: 'excel-layout-and-identity',
          message: '正式文件和审核保留逻辑行列、空白布局、合并及工作表身份'
        })
        return {
          records: records.map((record) => ({ path: record.path, changes: record.changeCount }))
        }
      },
      assert: async () => undefined
    })
  })
})
