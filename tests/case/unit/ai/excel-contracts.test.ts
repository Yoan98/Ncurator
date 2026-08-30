import { describe, expect, it } from 'vitest'
import { getSkillDefinition } from '../../../../src/main/services/ai/human/skills'
import {
  excelEditOutputShape,
  excelReadOutputShape
} from '../../../../src/main/services/ai/human/tools/excel/toolSchemas'
import { isTerminalExcelMutationCommand } from '../../../../src/main/services/ai/human/tools/terminal/commandPolicy'

describe('Excel static contracts', () => {
  it('declares readable output shapes and skill ownership', () => {
    expect(
      excelReadOutputShape.safeParse({
        sheets: [{ name: 'Sheet1', range: 'A1:B2', rowCount: 2, columnCount: 2 }]
      }).success
    ).toBe(true)
    expect(
      excelReadOutputShape.safeParse({
        sheetName: 'Sheet1',
        range: 'A1:B2',
        rows: [['a', 1]]
      }).success
    ).toBe(true)
    expect(
      excelReadOutputShape.safeParse({
        truncated: false,
        matches: [{ sheetName: 'Sheet1', address: 'A1', value: 'x' }]
      }).success
    ).toBe(true)
    expect(excelEditOutputShape.safeParse({}).success).toBe(true)
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
      'Copy-Item source.xlsx report.xlsx'
    ].forEach((command) => expect(isTerminalExcelMutationCommand(command)).toBe(true))
    ;[
      'ls -la report.xlsx',
      'stat report.xlsx',
      'Get-Item report.xlsx',
      'unzip -l report.xlsx'
    ].forEach((command) => expect(isTerminalExcelMutationCommand(command)).toBe(false))
  })
})
