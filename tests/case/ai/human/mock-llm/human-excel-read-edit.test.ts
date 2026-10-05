import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
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
        workbook.addWorksheet('Data').addRows([
          ['Item', 'Amount'],
          ['A', 12]
        ])
        const sourcePath = path.join(runtime.workspaceRoot, 'human-report.xlsx')
        const filePath = sourcePath
        await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: '把 human-report.xlsx 中 A 的金额更新为 20，并确认结果。',
          llmScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['excel-read', 'excel-write'],
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
              {
                output: buildToolDecision({
                  toolName: 'excel_read',
                  args: { type: 'range', sourcePath, sheetName: 'Data', range: 'A1:B2' },
                  summary: '读取目标数据'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'excel_edit',
                  args: {
                    type: 'set_range',
                    sourcePath,
                    sheetName: 'Data',
                    range: 'B2',
                    values: [[20]]
                  },
                  summary: '更新金额'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'excel_read',
                  args: { type: 'range', sourcePath, sheetName: 'Data', range: 'A1:B2' },
                  summary: '复读确认结果'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'Excel 已更新并确认。',
                  deliveryMarkdown: 'Data 工作表中 A 的金额已更新为 20。'
                })
              }
            ]
          }
        })
        const output = await runner.run()
        const actual = new ExcelJS.Workbook()
        await actual.xlsx.load((await fs.readFile(filePath)) as never)
        return {
          output,
          events: runtime.eventCollector.snapshot(),
          value: actual.getWorksheet('Data')?.getCell('B2').value
        }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const excelArtifact = filterAiRunEventsByType(result.events, 'file_artifact').find(
          (event) => event.capability === 'excel'
        )
        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.filter((event) => event.toolName === 'excel_read').length === 3 &&
            starts.some((event) => event.toolName === 'excel_edit') &&
            result.value === 20 &&
            Boolean(excelArtifact?.applyId),
          {
            name: 'human-excel-production-chain',
            message: 'human 应真实完成 Excel 读、写、复读并交付带修改记录的文件。',
            data: { starts, excelArtifact, value: result.value }
          }
        )
      }
    })
  })
})
