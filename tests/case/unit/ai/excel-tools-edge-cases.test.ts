import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { createExcelToolRuntime } from '../../../../src/main/services/ai/human/tools/excel/runtime'
import { isTerminalExcelMutationCommand } from '../../../../src/main/services/ai/human/tools/terminal/commandPolicy'

describe('Excel tools edge cases', () => {
  let workspaceRootPath = ''
  let records: AiFileChangeRecord[] = []

  beforeEach(async () => {
    workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-excel-edge-'))
    records = []
  })

  afterEach(async () => {
    await fs.rm(workspaceRootPath, { recursive: true, force: true })
  })

  const createRuntime = (options?: { failRecordSave?: boolean }) =>
    createExcelToolRuntime({
      ctx: {
        checkCancelled: () => undefined,
        sendEvent: () => undefined,
        saveFileChangeRecord: async (record: AiFileChangeRecord) => {
          if (options?.failRecordSave) throw new Error('record save failed')
          records = [...records.filter((item) => item.id !== record.id), record]
        }
      } as unknown as AiRunContext,
      cache: {},
      runId: 'excel-edge-run',
      sessionId: 'excel-edge-session',
      taskId: 'excel-edge-task',
      workspaceRootPath,
      emitActivity: () => undefined
    })

  const writeWorkbook = async (
    fileName: string,
    build: (workbook: ExcelJS.Workbook) => void
  ): Promise<{ filePath: string; bytes: Buffer }> => {
    const workbook = new ExcelJS.Workbook()
    build(workbook)
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
    const filePath = path.join(workspaceRootPath, fileName)
    await fs.writeFile(filePath, bytes)
    return { filePath, bytes }
  }

  const loadWorkbook = async (filePath: string): Promise<ExcelJS.Workbook> => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await fs.readFile(filePath)) as never)
    return workbook
  }

  it('searches workbook metadata, regex values and scoped sheets, then reads multiple ranges', async () => {
    await writeWorkbook('search.xlsx', (workbook) => {
      const data = workbook.addWorksheet('Data')
      data.addTable({
        name: 'RevenueTable',
        ref: 'A1',
        headerRow: true,
        columns: [{ name: 'Quarter' }, { name: 'Amount' }],
        rows: [
          ['Q1', 10],
          ['Q2', 20]
        ]
      })
      data.getTable('RevenueTable').commit()
      data.getCell('A1').value = 'Quarter'
      data.getCell('B1').value = 'Amount'
      data.getCell('A2').value = 'Q1'
      data.getCell('B2').value = 10
      data.getCell('A3').value = 'Q2'
      data.getCell('B3').value = 20
      data.getCell('C2').value = { formula: 'B2*2' }
      workbook.addWorksheet('Other').getCell('A1').value = 'Q3'
    })
    const runtime = createRuntime()

    const outline = await runtime.outline({ sourcePath: 'search.xlsx' })
    const table = await runtime.search({ sourcePath: 'search.xlsx', query: 'RevenueTable' })
    const column = await runtime.search({ sourcePath: 'search.xlsx', query: 'Amount' })
    const sheet = await runtime.search({ sourcePath: 'search.xlsx', query: 'Data' })
    const scopedRegex = await runtime.search({
      sourcePath: 'search.xlsx',
      query: '^Q[12]$',
      mode: 'regex',
      scope: { sheetNames: ['Data'] }
    })
    const read = await runtime.readCells({
      sourcePath: 'search.xlsx',
      ranges: [
        { sheetName: 'Data', range: '$A$2:B2' },
        { sheetName: 'Other', range: 'A1' }
      ]
    })

    expect(JSON.stringify(outline)).toContain('RevenueTable')
    expect(JSON.stringify(table)).toContain('table_name')
    expect(JSON.stringify(column)).toContain('table_column')
    expect(JSON.stringify(sheet)).toContain('sheet_name')
    expect(JSON.stringify(scopedRegex)).toContain('Q1')
    expect(JSON.stringify(scopedRegex)).toContain('Q2')
    expect(JSON.stringify(scopedRegex)).not.toContain('Q3')
    expect(read.cells).toHaveLength(3)
  })

  it('caps search results at 500 and reports truncation', async () => {
    await writeWorkbook('large.xlsx', (workbook) => {
      const sheet = workbook.addWorksheet('Data')
      for (let row = 1; row <= 21; row += 1) {
        for (let column = 1; column <= 25; column += 1) {
          sheet.getCell(row, column).value = `hit-${row}-${column}`
        }
      }
    })

    const result = await createRuntime().search({ sourcePath: 'large.xlsx', query: 'hit-' })
    expect(result.truncated).toBe(true)
    expect(result.matches).toHaveLength(500)
  })

  it('supports every edit operation and preserves styles and workbook structure', async () => {
    const { filePath } = await writeWorkbook('operations.xlsx', (workbook) => {
      workbook.addWorksheet('Data')
      workbook.addWorksheet('DeleteMe').getCell('A1').value = 'remove'
    })
    const runtime = createRuntime()

    await runtime.edit({
      sourcePath: 'operations.xlsx',
      action: 'update',
      operations: [
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
    await runtime.edit({
      sourcePath: 'operations.xlsx',
      action: 'update',
      operations: [
        { type: 'rename_sheet', sheetName: 'Summary', newName: 'Overview' },
        { type: 'merge_cells', sheetName: 'Overview', range: 'A1:B1' },
        { type: 'set_column_width', sheetName: 'Data', column: 'B', width: 24 },
        { type: 'insert_rows', sheetName: 'Data', startRow: 2, count: 1 },
        { type: 'set_cell', sheetName: 'Data', address: 'A2', value: 'Inserted' },
        { type: 'delete_rows', sheetName: 'Data', startRow: 4, count: 1 },
        { type: 'delete_sheet', sheetName: 'DeleteMe' }
      ]
    })

    const workbook = await loadWorkbook(filePath)
    const data = workbook.getWorksheet('Data')!
    const overview = workbook.getWorksheet('Overview')!
    expect(data.getCell('A1').font).toMatchObject({ bold: true, italic: true })
    expect(data.getCell('A1').font.color?.argb).toBe('FFFFFF')
    expect(data.getCell('A1').fill).toMatchObject({ fgColor: { argb: '2266AA' } })
    expect(data.getCell('A1').numFmt).toBe('0.00')
    expect(data.getCell('A1').alignment).toMatchObject({
      horizontal: 'center',
      vertical: 'middle'
    })
    expect(data.getCell('A2').value).toBe('Inserted')
    expect(data.getCell('A3').value).toBe('A')
    expect(data.getCell('C3').value).toMatchObject({ formula: 'B2*2' })
    expect(data.getColumn('B').width).toBe(24)
    expect(overview.getCell('A1').value).toBe('Overview')
    expect(overview.getCell('B1').isMerged).toBe(true)
    expect(workbook.getWorksheet('DeleteMe')).toBeUndefined()
    const workbookXml = await (await import('jszip')).default
      .loadAsync(await fs.readFile(filePath))
      .then((zip) => zip.file('xl/workbook.xml')!.async('text'))
    expect(workbookXml).toContain('fullCalcOnLoad="1"')
    expect(records).toHaveLength(1)
  })

  it('returns changed=false for a no-op without creating a change record', async () => {
    await writeWorkbook('noop.xlsx', (workbook) => {
      workbook.addWorksheet('Data').getCell('A1').value = 'same'
    })

    const result = await createRuntime().edit({
      sourcePath: 'noop.xlsx',
      action: 'update',
      operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 'same' }]
    })
    expect(result).toMatchObject({ changed: false, changes: [], postWriteReadback: [] })
    expect(records).toHaveLength(0)
  })

  it('rejects invalid paths, ranges, sheets, extensions and action conflicts', async () => {
    await writeWorkbook('existing.xlsx', (workbook) => workbook.addWorksheet('Data'))
    await fs.writeFile(path.join(workspaceRootPath, 'broken.xlsx'), 'not-a-workbook')
    const runtime = createRuntime()

    await expect(runtime.outline({ sourcePath: '../outside.xlsx' })).rejects.toThrow('当前工作区')
    await expect(runtime.outline({ sourcePath: 'data.csv' })).rejects.toThrow('只支持')
    await expect(runtime.outline({ sourcePath: 'broken.xlsx' })).rejects.toThrow()
    await expect(
      runtime.readCells({
        sourcePath: 'existing.xlsx',
        ranges: [{ sheetName: 'Missing', range: 'A1' }]
      })
    ).rejects.toThrow('工作表不存在')
    await expect(
      runtime.readCells({
        sourcePath: 'existing.xlsx',
        ranges: [{ sheetName: 'Data', range: 'B2:A1' }]
      })
    ).rejects.toThrow('无效的 A1 范围')
    await expect(
      runtime.edit({
        sourcePath: 'missing.xlsx',
        action: 'update',
        operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 1 }]
      })
    ).rejects.toThrow('Excel 文件不存在')
    await expect(
      runtime.edit({
        sourcePath: 'existing.xlsx',
        action: 'create',
        operations: [{ type: 'add_sheet', sheetName: 'Data' }]
      })
    ).rejects.toThrow('Excel 文件已存在')
  })

  it('allows macro-enabled files to be read but refuses to edit them', async () => {
    const { bytes } = await writeWorkbook('source.xlsx', (workbook) => {
      workbook.addWorksheet('Data').getCell('A1').value = 'macro-safe-read'
    })
    await fs.writeFile(path.join(workspaceRootPath, 'macro.xlsm'), bytes)
    const runtime = createRuntime()

    await expect(runtime.outline({ sourcePath: 'macro.xlsm' })).resolves.toMatchObject({
      sheetCount: 1
    })
    await expect(
      runtime.edit({
        sourcePath: 'macro.xlsm',
        action: 'update',
        operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 'changed' }]
      })
    ).rejects.toThrow('避免写回时丢失宏或模板信息')
  })

  it('detects external modifications between edits', async () => {
    const { filePath } = await writeWorkbook('conflict.xlsx', (workbook) => {
      workbook.addWorksheet('Data').getCell('A1').value = 1
    })
    const runtime = createRuntime()
    await runtime.edit({
      sourcePath: 'conflict.xlsx',
      action: 'update',
      operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 2 }]
    })
    const external = new ExcelJS.Workbook()
    external.addWorksheet('Data').getCell('A1').value = 99
    await fs.writeFile(filePath, Buffer.from(await external.xlsx.writeBuffer()))

    await expect(
      runtime.edit({
        sourcePath: 'conflict.xlsx',
        action: 'update',
        operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 3 }]
      })
    ).rejects.toThrow('操作期间发生变化')
  })

  it('restores the source and removes generated artifacts when record persistence fails', async () => {
    const { filePath, bytes } = await writeWorkbook('rollback.xlsx', (workbook) => {
      workbook.addWorksheet('Data').getCell('A1').value = 'before'
    })
    const runtime = createRuntime({ failRecordSave: true })

    await expect(
      runtime.edit({
        sourcePath: 'rollback.xlsx',
        action: 'update',
        operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 'after' }]
      })
    ).rejects.toThrow('record save failed')
    expect((await fs.readFile(filePath)).equals(bytes)).toBe(true)
    const fileChangesRoot = path.join(workspaceRootPath, '.ncurator', 'file-changes')
    const snapshotsRoot = path.join(workspaceRootPath, '.ncurator', 'file-change-snapshots')
    const generatedFiles = async (root: string): Promise<string[]> =>
      await fs
        .readdir(root, { recursive: true })
        .then((items) => items.filter((item) => path.extname(String(item))))
        .catch(() => [])
    expect(await generatedFiles(fileChangesRoot)).toEqual([])
    expect(await generatedFiles(snapshotsRoot)).toEqual([])
  })

  it('keeps the original baseline across multiple edits to the same file', async () => {
    const { bytes } = await writeWorkbook('baseline.xlsx', (workbook) => {
      const sheet = workbook.addWorksheet('Data')
      sheet.getCell('A1').value = 1
      sheet.getCell('B1').value = 10
    })
    const runtime = createRuntime()
    await runtime.edit({
      sourcePath: 'baseline.xlsx',
      action: 'update',
      operations: [{ type: 'set_cell', sheetName: 'Data', address: 'A1', value: 2 }]
    })
    await runtime.edit({
      sourcePath: 'baseline.xlsx',
      action: 'update',
      operations: [{ type: 'set_cell', sheetName: 'Data', address: 'B1', value: 20 }]
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.changeCount).toBe(2)
    expect((await fs.readFile(records[0]!.beforeSnapshotPath!)).equals(bytes)).toBe(true)
    const diff = await loadWorkbook(records[0]!.previewPath)
    expect(diff.getWorksheet('Data')?.getCell('A1').value).toBe(2)
    expect(diff.getWorksheet('Data')?.getCell('A1').border.left?.color?.argb).toBe('FF22A06B')
    expect(diff.getWorksheet('Data')?.getCell('B1').value).toBe(20)
    expect(diff.getWorksheet('Data')?.getCell('B1').border.left?.color?.argb).toBe('FF22A06B')
    expect(
      (await loadWorkbook(path.join(workspaceRootPath, 'baseline.xlsx')))
        .getWorksheet('Data')
        ?.getCell('A1').value
    ).toBe(2)
  })

  it('blocks common terminal mutation forms while allowing inspection commands', () => {
    const blocked = [
      'echo data > report.xlsx',
      'touch REPORT.XLSX',
      'rm report.xlsx',
      'mv old.xlsx new.xlsx',
      'rsync source.xlsx report.xlsx',
      'node update.js report.xlsx',
      'Set-Content -Path report.xlsx -Value data',
      'Copy-Item source.xlsx report.xlsx'
    ]
    const allowed = [
      'ls -la report.xlsx',
      'stat report.xlsx',
      'Get-Item report.xlsx',
      'unzip -l report.xlsx'
    ]
    blocked.forEach((command) => expect(isTerminalExcelMutationCommand(command)).toBe(true))
    allowed.forEach((command) => expect(isTerminalExcelMutationCommand(command)).toBe(false))
  })
})
