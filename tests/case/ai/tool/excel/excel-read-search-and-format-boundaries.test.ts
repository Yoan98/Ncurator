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
      description: '验证 Excel 网格读取、搜索截断、格式兼容和错误边界。',
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
        data.getCell('A1').font = { bold: true }
        data.getCell('A1').fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDDEBF7' }
        }
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
        const searchPath = path.join(runtime.workspaceRoot, 'search.xlsx')
        const outlines = await Promise.all(
          ['xlsx', 'xlsm', 'xltx', 'xltm'].map(
            async (extension) =>
              await harness.invoke<Record<string, unknown>>('excel_read', {
                type: 'workbook',
                sourcePath: path.join(runtime.workspaceRoot, `search.${extension}`)
              })
          )
        )
        const table = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'search',
          sourcePath: searchPath,
          query: 'RevenueTable'
        })
        const column = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'search',
          sourcePath: searchPath,
          query: 'Amount'
        })
        const sheet = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'search',
          sourcePath: searchPath,
          query: 'Data'
        })
        const scopedRegex = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'search',
          sourcePath: searchPath,
          query: '^Q[12]$',
          mode: 'regex',
          sheetName: 'Data'
        })
        const read = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'range',
          sourcePath: searchPath,
          sheetName: 'Data',
          range: '$A$2:B2'
        })
        const other = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'range',
          sourcePath: searchPath,
          sheetName: 'Other',
          range: 'A1'
        })
        const style = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'style',
          sourcePath: searchPath,
          sheetName: 'Data',
          range: 'A1'
        })
        const capped = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'search',
          sourcePath: path.join(runtime.workspaceRoot, 'large.xlsx'),
          query: 'hit-'
        })
        const overflow = await harness.invoke<Record<string, unknown>>('excel_read', {
          type: 'range',
          sourcePath: searchPath,
          sheetName: 'Data',
          range: 'A1:BZ80'
        })
        const failures = await Promise.all([
          harness.invoke<Record<string, unknown>>('excel_read', {
            type: 'workbook',
            sourcePath: path.join(path.dirname(runtime.workspaceRoot), 'outside.xlsx')
          }),
          harness.invoke<Record<string, unknown>>('excel_read', {
            type: 'workbook',
            sourcePath: path.join(runtime.workspaceRoot, 'data.csv')
          }),
          harness.invoke<Record<string, unknown>>('excel_read', {
            type: 'workbook',
            sourcePath: path.join(runtime.workspaceRoot, 'broken.xlsx')
          }),
          harness.invoke<Record<string, unknown>>('excel_read', {
            type: 'range',
            sourcePath: searchPath,
            sheetName: 'Missing',
            range: 'A1'
          }),
          harness.invoke<Record<string, unknown>>('excel_read', {
            type: 'range',
            sourcePath: searchPath,
            sheetName: 'Data',
            range: 'B2:A1'
          }),
          harness.invoke<Record<string, unknown>>('excel_read', {
            type: 'search',
            sourcePath: searchPath,
            query: '[',
            mode: 'regex'
          })
        ])

        return {
          outlines,
          table,
          column,
          sheet,
          scopedRegex,
          read,
          other,
          style,
          capped,
          overflow,
          failures
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outlines.every((outline) => Array.isArray(outline.sheets) && outline.sheets.length === 2) &&
            Array.isArray(result.table.matches) &&
            result.table.matches.length === 0 &&
            JSON.stringify(result.column).includes('Amount') &&
            Array.isArray(result.sheet.matches) &&
            result.sheet.matches.length === 0 &&
            JSON.stringify(result.scopedRegex).includes('Q1') &&
            JSON.stringify(result.scopedRegex).includes('Q2') &&
            !JSON.stringify(result.scopedRegex).includes('Q3') &&
            Array.isArray(result.read.rows) &&
            result.read.rows.length === 1 &&
            (result.read.rows[0] as unknown[]).length === 2 &&
            JSON.stringify(result.other.rows).includes('Q3') &&
            JSON.stringify(result.style).includes('bold'),
          {
            name: 'excel-read-search-contracts',
            message: '四种 Excel 格式、网格读取及单元格搜索应稳定工作，且不按表名命中。',
            data: result
          }
        )
        runtime.assertThat(
          result.capped.truncated === true &&
            Array.isArray(result.capped.matches) &&
            result.capped.matches.length === 10,
          {
            name: 'excel-search-result-cap',
            message: 'Excel 搜索结果应在 10 条截断并显式报告 truncated。',
            data: result.capped
          }
        )
        runtime.assertThat(
          Array.isArray(result.overflow.rows) &&
            result.overflow.rows.length === 80 &&
            result.failures.every((failure) => typeof failure.error === 'string'),
          {
            name: 'excel-read-failure-boundaries',
            message: '大 range 应正常返回网格；路径、扩展名、损坏文件、Sheet、range 和 regex 错误都应返回结构化失败。',
            data: { overflow: result.overflow, failures: result.failures }
          }
        )
      }
    })
  })
})
