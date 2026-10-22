import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createChatServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLoadToolsetsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm excel backend', () => {
  it('human-excel-read-edit', async () => {
    await runBackendCase({
      caseId: 'human-excel-read-edit',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 通过真实 graph 读取、修改并复读 Excel。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Data')
        sheet.addRows([
          ['Item', 'Amount', 'Double'],
          ['A', 12, { formula: 'B2*2', result: 24 }],
          ['区域外保留', 77]
        ])
        sheet.mergeCells('A4:B4')
        sheet.getCell('A4').value = '合并区域保留'
        const sourcePath = path.join(runtime.workspaceRoot, 'human-report.xlsx')
        const filePath = sourcePath
        await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))
        let sheetName = '',
          range = ''
        const runner = await createChatServiceTestRunner(runtime, {
          executionPermission: 'full_access',
          contentNodes: [
            {
              kind: 'document_selection',
              id: 'excel-region',
              number: 1,
              filePath,
              selectedText: JSON.stringify({
                display: [
                  ['Item', 'Amount', 'Double'],
                  ['A', '12', '24']
                ],
                cells: [
                  [
                    { value: 'Item', formula: null },
                    { value: 'Amount', formula: null },
                    { value: 'Double', formula: null }
                  ],
                  [
                    { value: 'A', formula: null },
                    { value: 12, formula: null },
                    { value: 24, formula: '=B2*2' }
                  ]
                ],
                merges: []
              }),
              contextBefore: '',
              contextAfter: '',
              children: [{ kind: 'text', text: '把该区域中 A 的金额更新为 20，并确认结果。' }],
              anchor: {
                kind: 'excel',
                sheetId: 'sheet-1',
                sheetName: 'Data',
                range: 'A1:C2',
                startRow: 0,
                endRow: 1,
                startColumn: 0,
                endColumn: 2
              }
            }
          ],
          llmScript: {
            'human.brain': [
              (call) => {
                const locator = call.user.match(
                  /<定位信息>\n工作表：([^\n]+)\n选中单元格范围：([^\n]+)/
                )
                if (!locator) throw new Error('Excel 引用缺少定位信息')
                sheetName = locator[1]
                range = locator[2]
                return buildLoadToolsetsDecision({
                  toolsetIds: ['excel-read', 'excel-write'],
                  summary: '学习 Excel 读写能力'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'excel_read',
                  args: { type: 'workbook', sourcePath },
                  summary: '读取工作簿概览'
                })
              },
              () =>
                buildToolDecision({
                  toolName: 'excel_read',
                  args: { type: 'range', sourcePath, sheetName, range },
                  summary: '读取目标数据'
                }),
              () =>
                buildToolDecision({
                  toolName: 'excel_edit',
                  args: {
                    type: 'set_range',
                    sourcePath,
                    sheetName,
                    range: 'B2',
                    values: [[20]]
                  },
                  summary: '更新金额'
                }),
              () =>
                buildToolDecision({
                  toolName: 'excel_read',
                  args: { type: 'range', sourcePath, sheetName, range },
                  summary: '复读确认结果'
                }),
              {
                output: buildCompleteTaskDecision({
                  summary: 'Excel 已更新并确认。',
                  deliveryMarkdown: 'Data 工作表中 A 的金额已更新为 20。'
                })
              }
            ]
          }
        })
        const submitted = await runner.submit()
        const output = await submitted.wait()
        const actual = new ExcelJS.Workbook()
        await actual.xlsx.load((await fs.readFile(filePath)) as never)
        const brainCalls = runner.io.filter((record) => record.caller === 'human.brain')
        const initialUser =
          brainCalls[0]?.requestWire?.messages
            .filter((message) => message.role === 'human')
            .map((message) => message.content)
            .join('\n') || ''
        const readCallIds = new Set(
          runner.events
            .filter((event) => event.type === 'tool_call_result' && event.toolName === 'excel_read')
            .map((event) => event.toolCallId)
        )
        const readToolContent = brainCalls
          .flatMap(
            (record) =>
              record.requestWire?.messages
                .filter(
                  (message) => message.role === 'tool' && readCallIds.has(message.toolCallId || '')
                )
                .map((message) => message.content) || []
          )
          .join('\n')
        const resultSheet = actual.getWorksheet('Data')!
        return {
          output,
          initialUser,
          readToolContent,
          sheetName,
          range,
          events: runtime.eventCollector.snapshot(),
          value: resultSheet.getCell('B2').value,
          formula: resultSheet.getCell('C2').value,
          outsideValue: resultSheet.getCell('B3').value,
          mergedValue: resultSheet.getCell('A4').value,
          merges: resultSheet.model.merges
        }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const excelArtifact = filterAiRunEventsByType(result.events, 'file_artifact').find(
          (event) => event.capability === 'excel'
        )
        runtime.assertThat(
          result.output?.status === 'completed' &&
            result.sheetName === 'Data' &&
            result.range === 'A1:C2' &&
            result.initialUser.includes(
              '<定位信息>\n工作表：Data\n选中单元格范围：A1:C2\n</定位信息>'
            ) &&
            !result.initialUser.includes('<选中内容>') &&
            !result.initialUser.includes('merges') &&
            !result.initialUser.includes('B2*2') &&
            !result.initialUser.includes('Double') &&
            result.readToolContent.includes('12') &&
            result.readToolContent.includes('B2*2') &&
            result.readToolContent.includes('Double') &&
            starts.filter((event) => event.toolName === 'excel_read').length === 3 &&
            starts.some((event) => event.toolName === 'excel_edit') &&
            result.value === 20 &&
            JSON.stringify(result.formula) === JSON.stringify({ formula: 'B2*2', result: 24 }) &&
            result.outsideValue === 77 &&
            result.mergedValue === '合并区域保留' &&
            result.merges.includes('A4:B4') &&
            Boolean(excelArtifact?.applyId),
          {
            name: 'human-excel-production-chain',
            message:
              'human 应仅凭区域定位读取 Excel 内容并完成读写复读，外围单元格和合并关系保留。',
            data: { starts, excelArtifact, ...result }
          }
        )
      }
    })
  })
})
