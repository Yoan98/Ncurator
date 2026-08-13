import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const hashFile = async (filePath: string): Promise<string> =>
  createHash('sha256').update(await fs.readFile(filePath)).digest('hex')

const writeWorkbook = async (filePath: string, build: (workbook: ExcelJS.Workbook) => void): Promise<void> => {
  const workbook = new ExcelJS.Workbook()
  build(workbook)
  await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))
}

const addHeaderStyle = (workbook: ExcelJS.Workbook, color: string): void => {
  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
  }
}

const buildSalesGapWorkbook = async (filePath: string): Promise<void> =>
  await writeWorkbook(filePath, (workbook) => {
    workbook.addWorksheet('Orders').addRows([
      ['Product', 'Region', 'Actual sales'],
      ['P-100', 'East', 820000],
      ['P-200', 'East', 1040000],
      ['P-300', 'North', 650000],
      ['P-400', 'South', 910000]
    ])
    workbook.addWorksheet('Targets').addRows([
      ['Product', 'Region', 'Target sales'],
      ['P-100', 'East', 1000000],
      ['P-200', 'East', 1000000],
      ['P-300', 'North', 800000],
      ['P-400', 'South', 900000]
    ])
    workbook.addWorksheet('Owners').addRows([
      ['Product', 'Owner'],
      ['P-100', 'Chen Lin'],
      ['P-200', 'Zhao Jing'],
      ['P-300', 'Zhou Yu'],
      ['P-400', 'Sun Yue']
    ])
    workbook.addWorksheet('Notes').addRows([
      ['Note'],
      ['P-200 has a refund record, but that does not change its quarterly target comparison.']
    ])
    addHeaderStyle(workbook, 'FFDDEBF7')
  })

const buildReconciliationWorkbook = async (filePath: string): Promise<void> =>
  await writeWorkbook(filePath, (workbook) => {
    const sales = workbook.addWorksheet('Sales')
    sales.addRows([
      ['Order ID', 'Customer', 'Amount', 'Invoice status'],
      ['SO-1001', 'Hangzhou Northstar', 120000, ''],
      ['SO-1002', 'Shanghai Voyager', 80000, 'Invoiced'],
      ['SO-1003', 'Ningbo Dawn', 60000, 'Not invoiced'],
      ['SO-1004', 'Suzhou Cloudfan', 150000, '']
    ])
    workbook.addWorksheet('Payments').addRows([
      ['Order ID', 'Payment amount'],
      ['SO-1001', 120000],
      ['SO-1002', 80000],
      ['SO-1004', 150000]
    ])
    workbook.addWorksheet('Reconciliation').addRows([
      ['Metric', 'Value'],
      ['Total sales', { formula: 'SUM(Sales!C2:C5)' }]
    ])
    addHeaderStyle(workbook, 'FFE2F0D9')
    sales.getColumn(3).numFmt = '#,##0'
    sales.getColumn(4).width = 18
  })

const hasSuccessfulToolResult = (
  events: ReturnType<typeof filterAiRunEventsByType>,
  toolName: string
): boolean => events.some((event) => event.toolName === toolName && event.result?.ok === true)

describe('ai human live excel backend', () => {
  it('human-excel-read-sales-gap-analysis-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-excel-read-sales-gap-analysis-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: 'Analyzes a sales workbook using a real local calculation and reports the business priorities in conversation.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'sales-operations.xlsx')
          await buildSalesGapWorkbook(sourcePath)
          const beforeHash = await hashFile(sourcePath)
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput:
              'Review sales-operations.xlsx for the sales meeting. Identify products below target, their regions and owners. Calculate actual sales, target sales, and gaps before telling me which items to prioritize. Do not modify the workbook.'
          })
          return {
            output,
            beforeHash,
            afterHash: await hashFile(sourcePath),
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const results = filterAiRunEventsByType(result.events, 'tool_call_result')
          const toolNames = starts.map((event) => event.toolName)
          runtime.assertThat(
            result.output.status === 'completed' &&
              result.beforeHash === result.afterHash &&
              !toolNames.includes('excel_edit') &&
              toolNames.some((name) => name.startsWith('excel_read') || name === 'excel_search') &&
              hasSuccessfulToolResult(results, 'terminal_run'),
            {
              name: 'human-live-excel-read-preserves-source-and-runs-real-calculation',
              message: 'The live model must read the workbook, complete a real local calculation, and preserve the source.',
              data: { toolNames }
            }
          )
        }
      })
    })
  })

  it('human-excel-write-reconciliation-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-excel-write-reconciliation-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: 'Uses a local calculation to update a finance reconciliation workbook and verify the delivered workbook.',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'finance-reconciliation.xlsx')
          await buildReconciliationWorkbook(sourcePath)
          const before = new ExcelJS.Workbook()
          await before.xlsx.load((await fs.readFile(sourcePath)) as never)
          const originalHeaderFill = before.getWorksheet('Sales')?.getCell('A1').fill.fgColor?.argb
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput:
              'Update finance-reconciliation.xlsx for the finance close. Compare Sales and Payments, mark paid orders with blank or Not invoiced status as Invoice required, then add Invoice required order count and amount formulas to Reconciliation. Preserve existing amounts, formulas, styles, and unaffected orders. Verify the workbook after editing.'
          })
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(sourcePath)) as never)
          const sales = workbook.getWorksheet('Sales')!
          const summary = workbook.getWorksheet('Reconciliation')!
          return {
            output,
            events: runtime.eventCollector.snapshot(),
            statuses: ['SO-1001', 'SO-1002', 'SO-1003', 'SO-1004'].map((orderId, index) => ({
              orderId,
              value: sales.getCell(`D${String(index + 2)}`).value
            })),
            summaryRows: summary.getSheetValues(),
            summaryFormulas: summary.getColumn(2).values,
            headerFill: sales.getCell('A1').fill.fgColor?.argb,
            originalHeaderFill
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const results = filterAiRunEventsByType(result.events, 'tool_call_result')
          const toolNames = starts.map((event) => event.toolName)
          const values = new Map(result.statuses.map((item) => [item.orderId, item.value]))
          const artifacts = filterAiRunEventsByType(result.events, 'file_artifact').filter(
            (artifact) => artifact.capability === 'excel' && artifact.operation === 'updated'
          )
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.some((name) => name.startsWith('excel_read') || name === 'excel_search') &&
              hasSuccessfulToolResult(results, 'excel_edit') &&
              values.get('SO-1001') === 'Invoice required' &&
              values.get('SO-1004') === 'Invoice required' &&
              values.get('SO-1002') === 'Invoiced' &&
              values.get('SO-1003') === 'Not invoiced' &&
              JSON.stringify(result.summaryRows).includes('Invoice required order count') &&
              JSON.stringify(result.summaryRows).includes('Invoice required amount') &&
              JSON.stringify(result.summaryFormulas).includes('SUMIF') &&
              result.headerFill === result.originalHeaderFill &&
              artifacts.length === 1,
            {
              name: 'human-live-excel-write-reconciles-real-workbook',
              message: 'The live model must update only the requested reconciliation data and preserve the workbook.',
              data: { toolNames, statuses: result.statuses, artifacts }
            }
          )
        }
      })
    })
  })
})
