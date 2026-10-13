import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createExcelToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const OPENPYXL_TARGET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../.pip-cache/test-openpyxl'
)

const resolvePythonBin = (): string => {
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
  for (const name of candidates) {
    try {
      execFileSync(name, ['--version'], { stdio: 'ignore' })
      return name
    } catch {
      // try next candidate
    }
  }
  throw new Error('python executable not found (tried python3/python)')
}

const ensureOpenpyxlTarget = (pythonBin: string): void => {
  try {
    execFileSync(pythonBin, ['-c', 'import openpyxl'], {
      env: { ...process.env, PYTHONPATH: OPENPYXL_TARGET },
      stdio: 'ignore'
    })
    return
  } catch {
    // install into project pip-cache target
  }
  execFileSync(pythonBin, ['-m', 'pip', 'install', '--target', OPENPYXL_TARGET, 'openpyxl'], {
    stdio: 'ignore'
  })
}

const readOpenpyxlFormats = (
  filePath: string,
  sheetName: string,
  addresses: string[]
): string[] => {
  const pythonBin = resolvePythonBin()
  ensureOpenpyxlTarget(pythonBin)
  const script = [
    'import json, openpyxl, sys',
    'wb = openpyxl.load_workbook(sys.argv[1])',
    'sheet = wb[sys.argv[2]]',
    'addrs = json.loads(sys.argv[3])',
    'print(json.dumps([sheet[addr].number_format for addr in addrs]))'
  ].join('\n')
  const output = execFileSync(
    pythonBin,
    ['-c', script, filePath, sheetName, JSON.stringify(addresses)],
    {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: OPENPYXL_TARGET }
    }
  ).trim()
  return JSON.parse(output) as string[]
}

describe('ai tool excel set_style backend', () => {
  it('excel-set-style-number-format-persistence', async () => {
    await runBackendCase({
      caseId: 'excel-set-style-number-format-persistence',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      description:
        '验证 set_range 写值后 set_style 设千分位可落盘，merge/auto_fit 后 ExcelJS 与 openpyxl 读回一致。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createExcelToolHarness(runtime)
        const sourcePath = path.join(runtime.workspaceRoot, 'budget.xlsx')
        await harness.invoke('excel_edit', {
          type: 'add_sheet',
          sourcePath,
          sheetName: '部门明细'
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath,
          sheetName: '部门明细',
          range: 'A1:D1',
          values: [['2026 年 9 月部门费用预算明细（单位：元）', '', '', '']]
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath,
          sheetName: '部门明细',
          range: 'A2:D19',
          values: [
            ['序号', '部门', '费用科目', '预算金额（元）'],
            ...Array.from({ length: 17 }, (_, index) => [
              index + 1,
              '市场部',
              `科目-${String(index + 1)}`,
              100_000 + index * 10_000
            ])
          ]
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath,
          sheetName: '部门明细',
          range: 'A20:D20',
          values: [['', '合计', '17 条明细', { formula: 'SUM(D3:D19)' }]],
          style: { bold: true, fillColor: 'FFF2F2F2' }
        })
        await harness.invoke('excel_edit', {
          type: 'set_style',
          sourcePath,
          sheetName: '部门明细',
          range: 'D3:D20',
          style: { numberFormat: '#,##0', horizontalAlignment: 'right' }
        })
        await harness.invoke('excel_edit', {
          type: 'set_style',
          sourcePath,
          sheetName: '部门明细',
          range: 'A2:D2',
          style: {
            bold: true,
            fontColor: 'FFFFFFFF',
            fillColor: 'FF1F4E79',
            horizontalAlignment: 'center'
          }
        })
        await harness.invoke('excel_edit', {
          type: 'merge_cells',
          sourcePath,
          sheetName: '部门明细',
          range: 'A1:D1'
        })
        await harness.invoke('excel_edit', {
          type: 'auto_fit',
          sourcePath,
          sheetName: '部门明细',
          range: 'A1:D20'
        })
        const styleRead = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'style',
          sourcePath,
          sheetName: '部门明细',
          range: 'D3:D5'
        })
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load((await fs.readFile(sourcePath)) as never)
        const sheet = workbook.getWorksheet('部门明细')!
        const openpyxlFormats = readOpenpyxlFormats(sourcePath, '部门明细', ['D3', 'D19', 'D20'])
        const sharedPath = path.join(runtime.workspaceRoot, 'shared-style.xlsx')
        const shared = new ExcelJS.Workbook()
        const sharedSheet = shared.addWorksheet('Shared')
        const commonStyle: Partial<ExcelJS.Style> = {
          font: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } },
          alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
        }
        for (let row = 2; row <= 46; row++) {
          sharedSheet.getCell(row, 1).style = commonStyle
          if (row <= 21) {
            sharedSheet.getCell(row, 1).value = row - 1
            sharedSheet.getCell(row, 2).value = row - 1
          }
        }
        const other = shared.addWorksheet('Other')
        other.getCell('A2').value = 'preserve other sheet'
        other.getCell('A2').style = commonStyle
        const merged = shared.addWorksheet('Merged')
        merged.getCell('A1').value = 100
        merged.getCell('A1').style = commonStyle
        merged.mergeCells('A1:B1')
        merged.getCell('C1').value = { formula: 'SUM(A1:B1)' }
        const sharedBytes = Buffer.from(await shared.xlsx.writeBuffer())
        await fs.writeFile(sharedPath, sharedBytes)
        const baseline = new ExcelJS.Workbook()
        await baseline.xlsx.load(sharedBytes as never)
        const sharedStyleLoaded =
          baseline.getWorksheet('Shared')!.getCell('A2').style ===
          baseline.getWorksheet('Shared')!.getCell('A22').style
        const outside = baseline.worksheets.flatMap((sheet) => {
          const cells: { sheet: string; address: string; fingerprint: string }[] = []
          sheet.eachRow({ includeEmpty: true }, (row) => {
            row.eachCell({ includeEmpty: true }, (cell) => {
              if (sheet.name === 'Shared' && cell.row === 22) return
              if (sheet.name === 'Merged' && cell.row === 1) return
              cells.push({
                sheet: sheet.name,
                address: cell.address,
                fingerprint: JSON.stringify({ value: cell.value, style: cell.style })
              })
            })
          })
          return cells
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: sharedPath,
          sheetName: 'Shared',
          range: 'A22:D22',
          values: [['平均', { formula: 'AVERAGE(B2:B21)' }, null, null]],
          style: { bold: true, fontColor: 'C0392B', fillColor: 'FFF3CD', numberFormat: '0.00' }
        })
        await harness.invoke('excel_edit', {
          type: 'set_style',
          sourcePath: sharedPath,
          sheetName: 'Shared',
          range: 'A22',
          style: { horizontalAlignment: 'right' }
        })
        await harness.invoke('excel_edit', {
          type: 'set_style',
          sourcePath: sharedPath,
          sheetName: 'Merged',
          range: 'A1:B1',
          style: { bold: false }
        })
        await harness.invoke('excel_edit', {
          type: 'set_style',
          sourcePath: sharedPath,
          sheetName: 'Merged',
          range: 'B1',
          style: { horizontalAlignment: 'right' }
        })
        const finalShared = new ExcelJS.Workbook()
        await finalShared.xlsx.load((await fs.readFile(sharedPath)) as never)
        const styleIsolation = outside.every((item) => {
          const cell = finalShared.getWorksheet(item.sheet)!.getCell(item.address)
          return JSON.stringify({ value: cell.value, style: cell.style }) === item.fingerprint
        })
        const summaryCell = finalShared.getWorksheet('Shared')!.getCell('A22')
        await harness.ctx.finalizeRunFileChanges()
        const sharedRecord = (
          await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
        ).find((record) => record.path === sharedPath)
        if (!sharedRecord?.previewPath) throw new Error('missing shared-style review')
        const sharedReview = new ExcelJS.Workbook()
        await sharedReview.xlsx.load((await fs.readFile(sharedRecord.previewPath)) as never)
        const green: string[] = []
        sharedReview.eachSheet((sheet) =>
          sheet.eachRow({ includeEmpty: true }, (row) =>
            row.eachCell({ includeEmpty: true }, (cell) => {
              if (cell.border?.left?.color?.argb === 'FF22A06B')
                green.push(`${sheet.name}!${cell.address}`)
            })
          )
        )
        return {
          excelJs: ['D3', 'D19', 'D20'].map((address) => sheet.getCell(address).numFmt),
          openpyxl: openpyxlFormats,
          styleRead: JSON.stringify(styleRead),
          sharedStyleLoaded,
          styleIsolation,
          preservedAlignment:
            summaryCell.alignment.vertical === 'middle' && summaryCell.alignment.wrapText === true,
          mergedStyle:
            finalShared.getWorksheet('Merged')!.getCell('A1').font.bold !== true &&
            finalShared.getWorksheet('Merged')!.getCell('B1').isMerged &&
            finalShared.getWorksheet('Merged')!.getCell('A1').alignment.horizontal === 'right',
          sharedReviewGreen: green.sort(),
          summaryResult: sharedReview.getWorksheet('Shared')!.getCell('B22').result,
          mergedResult: sharedReview.getWorksheet('Merged')!.getCell('C1').result
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.excelJs.every((format) => format === '#,##0') &&
            result.openpyxl.every((format) => format === '#,##0') &&
            result.styleRead.includes('numberFormat') &&
            result.styleRead.includes('#,##0'),
          {
            name: 'excel-set-style-number-format-persistence',
            message:
              'Create live 同路径：set_style 千分位应在 merge/auto_fit 后仍被 ExcelJS、openpyxl 和 excel_read style 读回。',
            data: result
          }
        )
        runtime.assertThat(
          result.sharedStyleLoaded &&
            result.styleIsolation &&
            result.preservedAlignment &&
            result.mergedStyle &&
            result.summaryResult === 10.5 &&
            result.mergedResult === 100 &&
            JSON.stringify(result.sharedReviewGreen) ===
              JSON.stringify([
                'Merged!A1',
                'Merged!B1',
                'Shared!A22',
                'Shared!B22',
                'Shared!C22',
                'Shared!D22'
              ]),
          {
            name: 'excel-local-style-isolation',
            message:
              '局部样式写入隔离共享对象，跨行与跨 Sheet 外围不变，合并与未指定格式保留，审核只标目标范围。',
            data: result
          }
        )
      }
    })
  })
})
