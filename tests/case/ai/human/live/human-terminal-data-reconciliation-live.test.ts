import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const hashFile = async (filePath: string): Promise<string> =>
  createHash('sha256').update(await fs.readFile(filePath)).digest('hex')

const readCsvRows = async (filePath: string): Promise<Array<{ type: string; recordId: string; amount: string }>> =>
  (await fs.readFile(filePath, 'utf8'))
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => {
      const [type = '', recordId = '', amount = ''] = line.split(',')
      return { type: type.trim(), recordId: recordId.trim(), amount: amount.trim() }
    })

describe('ai human live terminal backend', () => {
  it('human-terminal-data-reconciliation-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-terminal-data-reconciliation-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '用真实本地脚本对账两个业务文件，并交付财务可用的异常清单 CSV。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const invoicesPath = path.join(runtime.workspaceRoot, 'invoices.csv')
          const paymentsPath = path.join(runtime.workspaceRoot, 'payments.csv')
          await fs.writeFile(
            invoicesPath,
            'invoiceId,amount\nINV-001,120000\nINV-002,80000\nINV-003,60000\nINV-004,150000\n',
            'utf8'
          )
          await fs.writeFile(
            paymentsPath,
            'invoiceId,amount\nINV-001,120000\nINV-002,80000\nINV-004,150000\nINV-005,30000\n',
            'utf8'
          )
          const beforeHashes = await Promise.all([hashFile(invoicesPath), hashFile(paymentsPath)])
          const output = await createHumanTestRunner(runtime, {
          }).run({
            taskId: runtime.taskId,
            userInput:
              '请对账 invoices.csv 和 payments.csv。为财务生成 reconciliation-exceptions.csv，列包括 type、recordId、amount，覆盖未开发票的订单和没有对应订单的付款。类型列请填写 unpaid_invoice（未付发票）或 unmatched_payment（无匹配付款）。告诉我匹配与异常的合计金额，不要修改任何输入文件。'
          })
          return {
            output,
            beforeHashes,
            afterHashes: await Promise.all([hashFile(invoicesPath), hashFile(paymentsPath)]),
            rows: await readCsvRows(path.join(runtime.workspaceRoot, 'reconciliation-exceptions.csv')),
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          const results = filterAiRunEventsByType(result.events, 'tool_call_result')
          const rowAmountKeys = result.rows
            .map((row) => `${row.recordId}:${row.amount}`)
            .sort()
          const hasMeaningfulTypes = result.rows.every((row) => row.type.trim().length > 0)
          runtime.assertThat(
            result.output.status === 'completed' &&
              JSON.stringify(result.beforeHashes) === JSON.stringify(result.afterHashes) &&
              results.some((event) => event.toolName === 'terminal_run' && event.result?.ok === true) &&
              rowAmountKeys.join(',') === 'INV-003:60000,INV-005:30000' &&
              hasMeaningfulTypes,
            {
              name: 'human-live-terminal-data-reconciliation-delivers-finance-exceptions',
              message: 'The live model must compute the reconciliation and deliver the correct finance exception file.',
              data: { toolNames, rows: result.rows }
            }
          )
        }
      })
    })
  })
})
