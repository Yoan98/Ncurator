import { assertRunFileReviews } from '../../../../harness/backend/fileReviewAssertions'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/经营周报.xlsx' as const
const WORKSPACE_RELATIVE = '经营周报.xlsx'
const FLAGSHIP_PRODUCT = '华东-旗舰款'
const STANDARD_PRODUCT = '华北-标准款'
const ORDER_LAST_ROW = 121

const getFormula = (value: unknown): string => {
  if (!value || typeof value !== 'object' || !('formula' in value)) return ''
  return String((value as { formula?: unknown }).formula || '')
}

const findProductRow = (sheet: ExcelJS.Worksheet, product: string): number => {
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    if (String(sheet.getCell(`A${String(row)}`).value || '') === product) return row
  }
  return -1
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
        description: '在中文经营工作簿上更正数字、补公式、改表头，并保护部分区域。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, WORKSPACE_RELATIVE)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await (
            await createAiServiceTestRunner(runtime, {
              userInput: [
                `请更新工作区里的《${WORKSPACE_RELATIVE}》：`,
                '1）把「订单明细」表头「实际销售额」改成「实际销售额（元）」；',
                `2）把产品「${FLAGSHIP_PRODUCT}」的实际销售额更正为 680000；`,
                `3）在「汇总看板」增加一行「扣退货后净额」，公式为 SUM(订单明细!D2:D${String(ORDER_LAST_ROW)})-SUM(订单明细!E2:E${String(ORDER_LAST_ROW)})。`,
                '「口径说明」整表、「华北-标准款」整行、以及「区域目标」的「最低毛利率」列必须保持原样。'
              ].join('')
            })
          ).run()
          await assertRunFileReviews(runtime, output)
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(sourcePath)) as never)
          const orders = workbook.getWorksheet('订单明细')
          const targets = workbook.getWorksheet('区域目标')
          const summary = workbook.getWorksheet('汇总看板')
          const notes = workbook.getWorksheet('口径说明')
          const standardRow = orders ? findProductRow(orders, STANDARD_PRODUCT) : -1
          const flagshipRow = orders ? findProductRow(orders, FLAGSHIP_PRODUCT) : -1
          const records = (
            await runtime.storageService.aiFileChange.listRecords({
              runId: runtime.runId
            })
          ).items
          return {
            output,
            events: runtime.eventCollector.snapshot().slice(eventOffset),
            header: String(orders?.getCell('D1').value || ''),
            flagshipSales:
              flagshipRow > 0 ? orders?.getCell(`D${String(flagshipRow)}`).value : null,
            standardSales:
              standardRow > 0 ? orders?.getCell(`D${String(standardRow)}`).value : null,
            standardOwner:
              standardRow > 0 ? orders?.getCell(`C${String(standardRow)}`).value : null,
            targetMargins: [2, 3, 4, 5, 6].map((row) => targets?.getCell(`D${String(row)}`).value),
            notesText: [2, 3, 4].map((row) =>
              String(notes?.getCell(`C${String(row)}`).value || '')
            ),
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
              /实际销售额.*元/u.test(result.header) &&
              result.flagshipSales === 680000 &&
              result.standardSales === 1040000 &&
              result.standardOwner === '赵静' &&
              JSON.stringify(result.targetMargins) ===
                JSON.stringify([0.18, 0.16, 0.14, 0.15, 0.12]) &&
              result.notesText[0].includes('华东-旗舰款') &&
              result.notesText[1].includes('华北-标准款') &&
              result.notesText[2].includes('华西') &&
              result.summaryFormulas.some((formula) =>
                new RegExp(`SUM\\(订单明细!D2:D${String(ORDER_LAST_ROW)}\\)`, 'u').test(formula)
              ) &&
              result.summaryFormulas.some((formula) =>
                new RegExp(`SUM\\(订单明细!E2:E${String(ORDER_LAST_ROW)}\\)`, 'u').test(formula)
              ) &&
              result.recordCount === 1,
            {
              name: 'human-live-excel-weekly-review-edit-preserves-protected-areas',
              message: 'live 模型应先读后写，完成指定更正并保护口径说明、华北-标准款和目标毛利率。',
              data: {
                toolNames,
                header: result.header,
                flagshipSales: result.flagshipSales,
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
