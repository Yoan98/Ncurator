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
    execFileSync(
      pythonBin,
      ['-c', 'import openpyxl'],
      {
        env: { ...process.env, PYTHONPATH: OPENPYXL_TARGET },
        stdio: 'ignore'
      }
    )
    return
  } catch {
    // install into project pip-cache target
  }
  execFileSync(pythonBin, ['-m', 'pip', 'install', '--target', OPENPYXL_TARGET, 'openpyxl'], {
    stdio: 'ignore'
  })
}

const readOpenpyxlFormats = (filePath: string, sheetName: string, addresses: string[]): string[] => {
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
        return {
          excelJs: ['D3', 'D19', 'D20'].map((address) => sheet.getCell(address).numFmt),
          openpyxl: openpyxlFormats,
          styleRead: JSON.stringify(styleRead)
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
      }
    })
  })
})
