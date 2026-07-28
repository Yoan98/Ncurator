import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { getSkillDefinition } from '../../../../src/main/services/ai/human/skills'
import { isTerminalExcelMutationCommand } from '../../../../src/main/services/ai/human/tools/terminal/commandPolicy'
import { createExcelToolRuntime } from '../../../../src/main/services/ai/human/tools/excel/runtime'
import { EXCEL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/excel/toolSpecs'
import { renderToolOutputSchemaForPrompt } from '../../../../src/main/services/ai/human/tools/schemaPromptRenderer'

describe('Excel tools', () => {
  let workspaceRootPath: string
  let records: AiFileChangeRecord[]

  beforeEach(async () => {
    workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-excel-'))
    records = []
  })

  afterEach(async () => {
    await fs.rm(workspaceRootPath, { recursive: true, force: true })
  })

  const createRuntime = () =>
    createExcelToolRuntime({
      ctx: {
        checkCancelled: () => undefined,
        sendEvent: () => undefined,
        saveFileChangeRecord: async (record: AiFileChangeRecord) => {
          records = [...records.filter((item) => item.id !== record.id), record]
        }
      } as unknown as AiRunContext,
      cache: {},
      runId: 'excel-run',
      sessionId: 'excel-session',
      taskId: 'excel-task',
      workspaceRootPath,
      emitActivity: () => undefined
    })

  it('declares readable output shapes for every Excel tool', () => {
    const rendered = Object.fromEntries(
      EXCEL_TOOL_SPECS.map((spec) => [
        spec.name,
        renderToolOutputSchemaForPrompt(spec.outputSchema)
      ])
    )

    expect(rendered.excel_read_outline).toContain('sheetCount')
    expect(rendered.excel_search).toContain('matches')
    expect(rendered.excel_read_cells).toContain('cells')
    expect(rendered.excel_edit).toContain('changes')
    expect(Object.values(rendered)).not.toContain('  {}')
  })

  it('keeps excel-read and excel-write independent', () => {
    expect(getSkillDefinition('excel-read').toolNames).toEqual([
      'excel_read_outline',
      'excel_search',
      'excel_read_cells'
    ])
    expect(getSkillDefinition('excel-write').toolNames).toEqual(['excel_edit'])
  })

  it('creates, reads and updates values and formulas with a clean source and bordered diff', async () => {
    const runtime = createRuntime()
    const sourcePath = path.join(workspaceRootPath, 'report.xlsx')
    await runtime.edit({
      sourcePath: 'report.xlsx',
      action: 'create',
      sheets: ['Data'],
      operations: [
        { type: 'set_cell', sheetName: 'Data', address: 'A1', value: 'Amount' },
        { type: 'set_cell', sheetName: 'Data', address: 'A2', value: 12 },
        { type: 'set_cell', sheetName: 'Data', address: 'B2', formula: 'A2*2' }
      ]
    })

    const outline = await runtime.outline({ sourcePath: 'report.xlsx' })
    const read = await runtime.readCells({
      sourcePath: 'report.xlsx',
      ranges: [{ sheetName: 'Data', range: 'A1:B2' }]
    })
    const search = await runtime.search({ sourcePath: 'report.xlsx', query: 'A2*2' })
    expect(outline.sheetCount).toBe(1)
    expect(JSON.stringify(read)).toContain('A2*2')
    expect(JSON.stringify(search)).toContain('B2')

    await runtime.edit({
      sourcePath: 'report.xlsx',
      action: 'update',
      operations: [
        { type: 'set_cell', sheetName: 'Data', address: 'A2', value: 20 },
        { type: 'delete_cell', sheetName: 'Data', address: 'A1' }
      ]
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.capability).toBe('excel')
    expect(records[0]?.source).toBe('excel_tool')
    expect(records[0]?.deleteCount).toBeGreaterThanOrEqual(1)

    const actual = new ExcelJS.Workbook()
    await actual.xlsx.load((await fs.readFile(sourcePath)) as never)
    expect(actual.getWorksheet('Data')?.getCell('A2').value).toBe(20)
    expect(actual.getWorksheet('Data')?.getCell('A1').border?.left).toBeUndefined()

    const diff = new ExcelJS.Workbook()
    await diff.xlsx.load((await fs.readFile(records[0]!.previewPath!)) as never)
    expect(diff.getWorksheet('Data')?.getCell('A2').border.left?.color?.argb).toBe('FF22A06B')
    expect(diff.getWorksheet('Data')?.getCell('A1').border.left?.color?.argb).toBe('FFD14343')
    expect(diff.getWorksheet('Data')?.getCell('A1').value).toBe('Amount')
  })

  it('blocks terminal Excel mutations but allows ordinary reads', () => {
    expect(isTerminalExcelMutationCommand('python update.py report.xlsx')).toBe(true)
    expect(isTerminalExcelMutationCommand('cp source.xlsx report.xlsx')).toBe(true)
    expect(isTerminalExcelMutationCommand('ls report.xlsx')).toBe(false)
  })
})
