import { describe, expect, it } from 'vitest'
import { getSkillDefinition } from '../../../../src/main/services/ai/human/skills'
import { EXCEL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/excel/toolSpecs'
import { renderToolOutputSchemaForPrompt } from '../../../../src/main/services/ai/human/tools/schemaPromptRenderer'
import { isTerminalExcelMutationCommand } from '../../../../src/main/services/ai/human/tools/terminal/commandPolicy'

describe('Excel static contracts', () => {
  it('declares readable output shapes and skill ownership', () => {
    const rendered = Object.fromEntries(
      EXCEL_TOOL_SPECS.map((spec) => [
        spec.name,
        renderToolOutputSchemaForPrompt(spec.outputSchema)
      ])
    )
    expect(rendered.excel_read).toContain('sheets')
    expect(rendered.excel_read).toContain('rows')
    expect(rendered.excel_read).toContain('truncated')
    expect(rendered.excel_read).toContain('matches')
    expect(rendered.excel_edit.replace(/\s/g, '')).toBe('{}')
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
