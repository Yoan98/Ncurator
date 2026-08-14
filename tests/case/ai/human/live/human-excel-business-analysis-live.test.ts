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
        description: '用真实本地计算分析销售工作簿，并以对话方式汇报业务优先级。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, 'sales-operations.xlsx')
          await buildSalesGapWorkbook(sourcePath)
          const beforeHash = await hashFile(sourcePath)
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput:
              '请为销售会议审阅 sales-operations.xlsx：找出低于目标的产品、所属区域和负责人；请实际执行本地计算（例如使用终端）算出实际销售额、目标销售额和差额，再告诉我该优先处理哪些项。不要修改工作簿。'
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
              (toolNames.some((name) => name.startsWith('excel_read') || name === 'excel_search') ||
                toolNames.includes('terminal_run')) &&
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
        description: '用本地计算更新财务对账工作簿，并核对交付后的工作簿。',
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
              '请为财务结账更新 finance-reconciliation.xlsx：对比 Sales 和 Payments，把已付款但状态为空或 Not invoiced 的订单标记为 Invoice required，然后在 Reconciliation 里新增 Invoice required 订单数量和金额的公式。保留现有的金额、公式、样式和未涉及的订单。请实际执行本地计算核对销售与回款（例如使用终端），编辑后再核对工作簿。'
          })
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(sourcePath)) as never)
          const sales = workbook.getWorksheet('Sales')!
          const summary = workbook.getWorksheet('Reconciliation')!
          return {
            output,
            events: runtime.eventCollector.snapshot(),
            statuses: ['SO-1001', 'SO-1002', 'SO-1003', 'SO-1004'].map((orderId, index) => {
              const rowIndex = index + 2
              const invoiceStatus = sales.getCell(`D${String(rowIndex)}`).value
              const reconciliationStatus = sales.getCell(`E${String(rowIndex)}`).value
              return {
                orderId,
                value:
                  invoiceStatus === '' || invoiceStatus == null
                    ? reconciliationStatus
                    : invoiceStatus
              }
            }),
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
              hasSuccessfulToolResult(results, 'terminal_run') &&
              hasSuccessfulToolResult(results, 'excel_edit') &&
              values.get('SO-1001') === 'Invoice required' &&
              values.get('SO-1004') === 'Invoice required' &&
              values.get('SO-1002') === 'Invoiced' &&
              values.get('SO-1003') === 'Not invoiced' &&
              /Invoice required[^"]*count/.test(JSON.stringify(result.summaryRows)) &&
              /Invoice required[^"]*amount/.test(JSON.stringify(result.summaryRows)) &&
              JSON.stringify(result.summaryFormulas).includes('SUMIF') &&
              result.headerFill === result.originalHeaderFill &&
              artifacts.length >= 1,
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
