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

const normalizeExceptionType = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/gu, '_')

describe('ai human live terminal backend', () => {
  it('human-terminal-data-reconciliation-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-terminal-data-reconciliation-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: 'Uses a real local script to reconcile two business files and delivers a finance-ready exception CSV.',
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
            allowedToolNames: ['terminal_run', 'terminal_read', 'terminal_stop', 'text_file_edit']
          }).run({
            taskId: runtime.taskId,
            userInput:
              'Reconcile invoices.csv and payments.csv. Create reconciliation-exceptions.csv for Finance with columns type,recordId,amount for unpaid invoices and payments without a matching invoice. Tell me the matched and exception totals, and do not modify either input file.'
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
          const rowKeys = result.rows
            .map((row) => `${normalizeExceptionType(row.type)}:${row.recordId}:${row.amount}`)
            .sort()
          runtime.assertThat(
            result.output.status === 'completed' &&
              JSON.stringify(result.beforeHashes) === JSON.stringify(result.afterHashes) &&
              results.some((event) => event.toolName === 'terminal_run' && event.result?.ok === true) &&
              rowKeys.join(',') === 'unmatched_payment:INV-005:30000,unpaid_invoice:INV-003:60000',
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
