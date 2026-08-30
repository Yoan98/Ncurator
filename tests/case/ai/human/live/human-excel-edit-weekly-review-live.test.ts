import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/operating-review.xlsx' as const
const WORKSPACE_RELATIVE = 'operating-review.xlsx'

const getFormula = (value: unknown): string => {
  if (!value || typeof value !== 'object' || !('formula' in value)) return ''
  return String((value as { formula?: unknown }).formula || '')
}

describe('ai human live excel edit backend', () => {
  it('human-excel-edit-weekly-review-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-excel-edit-weekly-review-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '在既有经营工作簿上更正数字、补公式、改表头，并保护部分区域。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, WORKSPACE_RELATIVE)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput: [
              `请更新工作区中的 ${WORKSPACE_RELATIVE}：`,
              '1）把 Orders 表头 “Actual sales” 改成 “Actual sales (CNY)”；',
              '2）把 P-300 的 Actual sales 更正为 680000；',
              '3）在 Summary 增加一行 Net after returns，公式为 SUM(Orders!D2:D6)-SUM(Orders!E2:E6)。',
              'Notes 整表、P-200 整行、Targets 的 Min margin 列必须保持原样。'
            ].join('')
          })
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(sourcePath)) as never)
          const orders = workbook.getWorksheet('Orders')
          const targets = workbook.getWorksheet('Targets')
          const summary = workbook.getWorksheet('Summary')
          const notes = workbook.getWorksheet('Notes')
          const records = await runtime.createAiRunContext().listFileChangeRecords({
            runId: runtime.runId
          })
          return {
            output,
            events: runtime.eventCollector.snapshot().slice(eventOffset),
            header: String(orders?.getCell('D1').value || ''),
            p300: orders?.getCell('D4').value,
            p200: orders?.getCell('D3').value,
            p200Owner: orders?.getCell('C3').value,
            targetMargins: [2, 3, 4, 5, 6].map((row) => targets?.getCell(`D${String(row)}`).value),
            notesText: [2, 3, 4].map((row) => String(notes?.getCell(`C${String(row)}`).value || '')),
            summaryFormulas: summary
              ? Array.from({ length: Math.max(summary.rowCount, 1) }, (_, index) =>
                  getFormula(summary.getCell(index + 1, 2).value)
                )
              : [],
            recordCount: records.filter((record) => record.path === sourcePath).length
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          const readBeforeEdit =
            toolNames.indexOf('excel_read') !== -1 &&
            toolNames.indexOf('excel_read') < toolNames.indexOf('excel_edit')
          runtime.assertThat(
            result.output.status === 'completed' &&
              readBeforeEdit &&
              toolNames.includes('excel_edit') &&
              /CNY/i.test(result.header) &&
              result.p300 === 680000 &&
              result.p200 === 1040000 &&
              result.p200Owner === 'Zhao Jing' &&
              JSON.stringify(result.targetMargins) === JSON.stringify([0.18, 0.16, 0.14, 0.15, 0.12]) &&
              result.notesText[0].includes('P-300 return rate') &&
              result.notesText[1].includes('P-200 refund') &&
              result.notesText[2].includes('West region target') &&
              result.summaryFormulas.some((formula) => /SUM\(Orders!D2:D6\)/i.test(formula)) &&
              result.summaryFormulas.some((formula) => /SUM\(Orders!E2:E6\)/i.test(formula)) &&
              result.recordCount === 1,
            {
              name: 'human-live-excel-weekly-review-edit-preserves-protected-areas',
              message: 'live 模型应先读后写，完成指定更正并保护 Notes、P-200 和目标利润率。',
              data: {
                toolNames,
                header: result.header,
                p300: result.p300,
                recordCount: result.recordCount,
                summaryFormulas: result.summaryFormulas
              }
            }
          )
        }
      })
    })
  })
})
