import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { describe, it, expect } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'

const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const FIXTURES = [
  'tests/fixtures/workspace/经营周报.xlsx',
  'tests/fixtures/workspace/sample-edit.docx',
  'tests/fixtures/workspace/subagent-checkout-config.ts'
]

describe('live subagent collaboration quality', () => {
  it('human-subagent-collaboration-live', async () => {
    await runBackendCase({
      caseId: 'human-subagent-collaboration-live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      harnessMode: 'live',
      fixtures: FIXTURES,
      runMode: 'single',
      description: '三项真实独立任务由子 agent 完成，主伙伴交付带依据的报告',
      execute: async (runtime) => {
        const xlsx = runtime.getFixtureWorkspacePath(FIXTURES[0])
        const docx = runtime.getFixtureWorkspacePath(FIXTURES[1])
        const config = runtime.getFixtureWorkspacePath(FIXTURES[2])
        const report = path.join(runtime.workspaceRoot, '交接报告.md')
        const beforeSheet = await fs.readFile(xlsx)
        const beforeDoc = (await mammoth.extractRawText({ path: docx })).value
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(beforeSheet)
        const sheet = workbook.getWorksheet('订单明细')!
        let sales = 0,
          returns = 0
        sheet.eachRow((row, index) => {
          if (index > 1) {
            sales += Number(row.getCell('D').value || 0)
            returns += Number(row.getCell('E').value || 0)
          }
        })
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: `请找三位临时帮手分头做这三件独立的事，每位负责一项，你最后整合交付：\n1. 只读 ${xlsx} 的订单明细，核对 D 列销售额和 E 列退货金额的合计及净额，实际计算验证。\n2. 修改 ${config}：主备端点都改成 https://api.example.com/v2/checkout，超时改为 3000；重试次数和遥测保持原样。\n3. 把 ${docx} 中的 Hello from fixture 改成 Hello from safe edit，其余内容保持原样。\n然后你自己写 ${report}，包含三项结果、准确金额及资料链接，检查保存的文件后交付。`
        })
        const startedAt = Date.now()
        const output = await runner.run()
        return {
          output,
          sales,
          returns,
          net: sales - returns,
          beforeDoc,
          afterDoc: (await mammoth.extractRawText({ path: docx })).value,
          sheetUnchanged: hash(beforeSheet) === hash(await fs.readFile(xlsx)),
          config: await fs.readFile(config, 'utf8'),
          report: await fs.readFile(report, 'utf8'),
          changes: (
            await runtime.storageService.aiFileChange.listRecords({ runId: runner.payload.runId })
          ).items,
          records: await runtime.storageService.chatMessageLog.list(runner.payload.partnerId),
          events: runner.events.slice(),
          io: runner.io.slice(),
          durationMs: Date.now() - startedAt
        }
      },
      assert: async (result, runtime) => {
        expect(result.output.status).toBe('completed')
        const completed = result.events.filter(
          (event) => event.type === 'subagent_updated' && event.update.status === 'completed'
        )
        expect(
          new Set(
            completed.map((event) =>
              event.type === 'subagent_updated' ? event.update.childRunId : ''
            )
          ).size
        ).toBe(3)
        expect(result.sheetUnchanged).toBe(true)
        expect(result.config.match(/https:\/\/api.example.com\/v2\/checkout/g)).toHaveLength(2)
        expect(result.config).toMatch(/timeoutMs\s*=\s*3000/)
        expect(result.config).toMatch(/retryCount\s*=\s*2/)
        expect(result.config).toContain("'checkout-prod'")
        expect(result.afterDoc).toBe(
          result.beforeDoc.replace('Hello from fixture', 'Hello from safe edit')
        )
        const numericReport = result.report.replaceAll(',', '')
        for (const number of [result.sales, result.returns, result.net])
          expect(numericReport).toContain(String(number))
        expect(result.report).toMatch(/\]\(/)
        expect(result.changes.length).toBeGreaterThanOrEqual(3)
        expect(result.changes.every((change) => change.runId === runtime.runId)).toBe(true)
        expect(
          result.events.some(
            (event) =>
              event.type === 'subagent_updated' &&
              event.update.action?.toolName === 'terminal_run' &&
              event.update.action.status === 'completed'
          )
        ).toBe(true)
        runtime.recordEvent({
          type: 'signal',
          status: 'info',
          name: 'subagent-usage',
          message: '主子 token 与缓存证据来自 LLM I/O；质量评分由执行后证据审阅填写',
          data: {
            durationMs: result.durationMs,
            calls: result.io.map((record) => ({
              runId: record.runId,
              ownerRunId: record.ownerRunId || record.runId,
              usage: record.usage || null
            }))
          }
        })
        runtime.assertThat(true, {
          name: 'collaboration-facts',
          message: '真实派发、计算、文件保护与主报告事实全部完成'
        })
      }
    })
  }, 1_800_000)
})
