import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FILE_NAME = 'monthly-budget.xlsx'

const getFormula = (value: unknown): string => {
  if (!value || typeof value !== 'object' || !('formula' in value)) return ''
  return String((value as { formula?: unknown }).formula || '')
}

describe('ai human live excel create backend', () => {
  it('human-excel-create-monthly-budget-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-excel-create-monthly-budget-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '空工作区从零做月度预算：多表、表头、SUM/SUMIF 和金额格式。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, FILE_NAME)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput: [
              `请直接在工作区创建“${FILE_NAME}”，做一份很小的月度预算即可：`,
              '只要 2 个工作表：Departments 和 Summary。',
              'Departments 写表头（部门、科目、金额）和 3 行示例数据。',
              'Summary 用 SUM 或 SUMIF 汇总金额，不要手填合计；金额用千分位格式。',
              '不要再扩展月份列或大表。完成后确认文件可打开并停止。'
            ].join('')
          })
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(sourcePath)) as never)
          const formulas = workbook.worksheets.flatMap((sheet) => {
            const found: string[] = []
            sheet.eachRow((row) =>
              row.eachCell((cell) => {
                const formula = getFormula(cell.value)
                if (formula) found.push(formula)
              })
            )
            return found
          })
          const numberFormats = workbook.worksheets.flatMap((sheet) => {
            const found: string[] = []
            sheet.eachRow((row) =>
              row.eachCell((cell) => {
                if (cell.numFmt) found.push(cell.numFmt)
              })
            )
            return found
          })
          const excelRecords = (
            await runtime.createAiRunContext().listFileChangeRecords({ runId: runtime.runId })
          ).filter((record) => record.capability === 'excel')
          return {
            output,
            events: runtime.eventCollector.snapshot().slice(eventOffset),
            sheetCount: workbook.worksheets.length,
            sheetNames: workbook.worksheets.map((sheet) => sheet.name),
            formulas,
            numberFormats,
            artifacts: excelRecords.length
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.includes('excel_edit') &&
              result.sheetCount >= 2 &&
              result.formulas.some((formula) => /SUM(IF)?\(/i.test(formula)) &&
              result.numberFormats.some((format) => /#,##0/.test(format) || /0\.00/.test(format)) &&
              result.artifacts === 1,
            {
              name: 'human-live-excel-create-monthly-budget',
              message: 'live human 应从零创建可解析的月度预算：多表、汇总为公式，并交付 1 个 artifact。',
              data: {
                toolNames,
                sheetNames: result.sheetNames,
                formulas: result.formulas,
                numberFormats: result.numberFormats,
                artifacts: result.artifacts
              }
            }
          )
        }
      })
    })
  })
})
