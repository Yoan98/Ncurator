import { describe, expect, it } from 'vitest'
import { getSkillDefinition } from '../../../../src/main/services/ai/human/skills'
import type {
  ExcelEditOutput,
  ExcelReadOutput
} from '../../../../src/main/services/ai/human/tools/excel/outputTypes'
import { isTerminalExcelMutationCommand } from '../../../../src/main/services/ai/human/tools/terminal/commandPolicy'

describe('Excel static contracts', () => {
  it('declares readable output shapes and skill ownership', () => {
    const workbookSample = {
      sheets: [{ name: 'Sheet1', range: 'A1:B2', rowCount: 2, columnCount: 2 }]
    } satisfies ExcelReadOutput
    const rangeSample = {
      sheetName: 'Sheet1',
      range: 'A1:B2',
      rows: [['a', 1]]
    } satisfies ExcelReadOutput
    const searchSample = {
      totalMatchCount: 1,
      returnedMatchCount: 1,
      matches: [{ sheetName: 'Sheet1', address: 'A1', value: 'x' }]
    } satisfies ExcelReadOutput
    const editSample = {} satisfies ExcelEditOutput

    expect(workbookSample.sheets).toHaveLength(1)
    expect(rangeSample.rows[0]).toEqual(['a', 1])
    expect(searchSample.matches[0]?.address).toBe('A1')
    expect(editSample).toEqual({})
    expect(getSkillDefinition('excel-read').toolNames).toEqual(['excel_read'])
    expect(getSkillDefinition('excel-write').toolNames).toEqual(['excel_edit'])
  })

  it('blocks terminal Excel mutations but allows inspection', () => {
    ;[
      'echo data > report.xlsx',
      'touch REPORT.XLSX',
      'rm report.xlsx',
      'mv old.xlsx new.xlsx',
      'rsync source.xlsx report.xlsx',
      'node update.js report.xlsx',
      'Set-Content -Path report.xlsx -Value data',
      'Copy-Item source.xlsx report.xlsx',
      'python3 -c "import openpyxl; wb=openpyxl.Workbook(); wb.save(\'report.xlsx\')"',
      'python3 -c "import pandas as pd; pd.to_excel(\'report.xlsx\')"'
    ].forEach((command) => expect(isTerminalExcelMutationCommand(command)).toBe(true))
    ;[
      'ls -la report.xlsx',
      'stat report.xlsx',
      'Get-Item report.xlsx',
      'unzip -l report.xlsx',
      'python3 -c "import openpyxl; wb=openpyxl.load_workbook(\'report.xlsx\'); print(wb.sheetnames)"',
      "python3 <<'EOF'\nimport openpyxl\nwb = openpyxl.load_workbook('report.xlsx')\nprint(wb.sheetnames)\nEOF"
    ].forEach((command) => expect(isTerminalExcelMutationCommand(command)).toBe(false))
  })
})
