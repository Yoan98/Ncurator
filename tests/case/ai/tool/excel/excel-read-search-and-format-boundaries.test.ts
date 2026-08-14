import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createExcelToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool excel read backend', () => {
  it('excel-read-search-and-format-boundaries', async () => {
    await runBackendCase({
      caseId: 'excel-read-search-and-format-boundaries',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      description: '验证 Excel 多范围读取、搜索 scope/regex/截断、格式兼容和错误边界。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const workbook = new ExcelJS.Workbook()
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
        data.getCell('C2').value = { formula: 'B2*2' }
        workbook.addWorksheet('Other').getCell('A1').value = 'Q3'
        const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
        await Promise.all(
          ['xlsx', 'xlsm', 'xltx', 'xltm'].map(async (extension) => {
            await fs.writeFile(path.join(runtime.workspaceRoot, `search.${extension}`), bytes)
          })
        )

        const large = new ExcelJS.Workbook()
        const largeSheet = large.addWorksheet('Data')
        for (let row = 1; row <= 21; row += 1) {
          for (let column = 1; column <= 25; column += 1) {
            largeSheet.getCell(row, column).value = `hit-${row}-${column}`
          }
        }
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'large.xlsx'),
          Buffer.from(await large.xlsx.writeBuffer())
        )
        await fs.writeFile(path.join(runtime.workspaceRoot, 'broken.xlsx'), 'not-a-workbook')

        const harness = createExcelToolHarness(runtime)
        const outlines = await Promise.all(
          ['xlsx', 'xlsm', 'xltx', 'xltm'].map(
            async (extension) =>
              await harness.invoke<Record<string, unknown>>('excel_read_outline', {
                sourcePath: path.join(runtime.workspaceRoot, `search.${extension}`)
              })
          )
        )
        const table = await harness.invoke<Record<string, unknown>>('excel_search', {
          sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
          query: 'RevenueTable'
        })
        const column = await harness.invoke<Record<string, unknown>>('excel_search', {
          sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
          query: 'Amount'
        })
        const sheet = await harness.invoke<Record<string, unknown>>('excel_search', {
          sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
          query: 'Data'
        })
        const scopedRegex = await harness.invoke<Record<string, unknown>>('excel_search', {
          sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
          query: '^Q[12]$',
          mode: 'regex',
          scope: { sheetNames: ['Data'] }
        })
        const read = await harness.invoke<Record<string, unknown>>('excel_read_cells', {
          sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
          ranges: [
            { sheetName: 'Data', range: '$A$2:B2' },
            { sheetName: 'Other', range: 'A1' }
          ]
        })
        const capped = await harness.invoke<Record<string, unknown>>('excel_search', {
          sourcePath: path.join(runtime.workspaceRoot, 'large.xlsx'),
          query: 'hit-'
        })
        const failures = await Promise.all([
          harness.invoke<Record<string, unknown>>('excel_read_outline', {
            sourcePath: path.join(path.dirname(runtime.workspaceRoot), 'outside.xlsx')
          }),
          harness.invoke<Record<string, unknown>>('excel_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'data.csv')
          }),
          harness.invoke<Record<string, unknown>>('excel_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'broken.xlsx')
          }),
          harness.invoke<Record<string, unknown>>('excel_read_cells', {
            sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
            ranges: [{ sheetName: 'Missing', range: 'A1' }]
          }),
          harness.invoke<Record<string, unknown>>('excel_read_cells', {
            sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
            ranges: [{ sheetName: 'Data', range: 'B2:A1' }]
          }),
          harness.invoke<Record<string, unknown>>('excel_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'search.xlsx'),
            query: '[',
            mode: 'regex'
          })
        ])

        return { outlines, table, column, sheet, scopedRegex, read, capped, failures }
      },
      assert: async (result, runtime) => {
        const serialized = JSON.stringify(result)
        runtime.assertThat(
          result.outlines.every((outline) => outline.sheetCount === 2) &&
            serialized.includes('table_name') &&
            serialized.includes('table_column') &&
            serialized.includes('sheet_name') &&
            JSON.stringify(result.scopedRegex).includes('Q1') &&
            JSON.stringify(result.scopedRegex).includes('Q2') &&
            !JSON.stringify(result.scopedRegex).includes('Q3') &&
            Array.isArray(result.read.cells) &&
            result.read.cells.length === 3,
          {
            name: 'excel-read-search-contracts',
            message: '四种 Excel 格式、多范围读取及 metadata/regex/scope 搜索应稳定工作。',
            data: result
          }
        )
        runtime.assertThat(
          result.capped.truncated === true &&
            Array.isArray(result.capped.matches) &&
            result.capped.matches.length === 500,
          {
            name: 'excel-search-result-cap',
            message: 'Excel 搜索结果应在 500 条截断并显式报告。',
            data: result.capped
          }
        )
        runtime.assertThat(
          result.failures.every((failure) => typeof failure.error === 'string'),
          {
            name: 'excel-read-failure-boundaries',
            message: '路径、扩展名、损坏文件、Sheet、range 和 regex 错误都应返回结构化失败。',
            data: result.failures
          }
        )
      }
    })
  })
})
