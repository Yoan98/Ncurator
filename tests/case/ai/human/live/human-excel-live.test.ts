import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const liveModelName = (): string | null =>
  hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null

describe('ai human excel live backend', () => {
  it('human-excel-read-edit-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-excel-read-edit-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证真实模型能从自然语言自主修改并确认已有 Excel。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: liveModelName(),
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv())
            return { skipped: true, output: null, events: [], value: null }
          const workbook = new ExcelJS.Workbook()
          workbook.addWorksheet('Data').addRows([
            ['Item', 'Amount'],
            ['A', 12],
            ['B', 8]
          ])
          const filePath = path.join(runtime.workspaceRoot, 'sales.xlsx')
          await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const output = await createHumanTestRunner(runtime, {
            allowedToolNames: [
              'excel_read_outline',
              'excel_search',
              'excel_read_cells',
              'excel_edit'
            ]
          }).run({
            taskId: runtime.taskId,
            userInput:
              '请把 sales.xlsx 的 Data 工作表中 Item 为 A 的 Amount 改成 20，完成后核对文件里的实际结果。'
          })
          const actual = new ExcelJS.Workbook()
          await actual.xlsx.load((await fs.readFile(filePath)) as never)
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            value: actual.getWorksheet('Data')?.getCell('B2').value
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 Excel 修改 live case。'
            })
            return
          }
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          runtime.assertThat(
            result.output?.status === 'completed' &&
              starts.some((event) => event.toolName === 'excel_edit') &&
              starts.some((event) => event.toolName.startsWith('excel_read')) &&
              result.value === 20 &&
              result.output.artifacts.some(
                (artifact) => artifact.kind === 'file' && artifact.capability === 'excel'
              ),
            {
              name: 'human-live-excel-read-edit',
              message: 'live human 应自主完成已有 Excel 的定位、修改、核对和交付。',
              data: {
                tools: starts.map((event) => event.toolName),
                value: result.value,
                artifacts: result.output?.artifacts
              }
            }
          )
        }
      })
    })
  })

  it('human-create-excel-report-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-create-excel-report-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证真实模型能从自然语言创建多 Sheet、公式和基础格式的 Excel 报表。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: liveModelName(),
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv())
            return { skipped: true, output: null, events: [], workbook: null }
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const output = await createHumanTestRunner(runtime, {
            allowedToolNames: [
              'excel_read_outline',
              'excel_search',
              'excel_read_cells',
              'excel_edit'
            ]
          }).run({
            taskId: runtime.taskId,
            userInput:
              '请新建 quarterly-report.xlsx。包含“明细”和“汇总”两个工作表；明细表有产品、Q1、Q2 三列和 A/10/20、B/5/15 两行数据，表头加粗并使用填充色；汇总表写入总金额，并用公式计算四个季度数值之和。完成后核对工作表和公式。'
          })
          const filePath = path.join(runtime.workspaceRoot, 'quarterly-report.xlsx')
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(filePath)) as never)
          const formulaCells: string[] = []
          workbook.eachSheet((sheet) => {
            sheet.eachRow((row) => {
              row.eachCell((cell) => {
                if (cell.value && typeof cell.value === 'object' && 'formula' in cell.value) {
                  formulaCells.push(String(cell.value.formula))
                }
              })
            })
          })
          const detail = workbook.getWorksheet('明细')
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            workbook: {
              sheets: workbook.worksheets.map((sheet) => sheet.name),
              formulas: formulaCells,
              headerBold: detail?.getCell('A1').font.bold === true,
              headerHasFill: detail?.getCell('A1').fill.type === 'pattern'
            }
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 Excel 创建 live case。'
            })
            return
          }
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          runtime.assertThat(
            result.output?.status === 'completed' &&
              starts.some((event) => event.toolName === 'excel_edit') &&
              starts.some((event) => event.toolName.startsWith('excel_read')) &&
              result.workbook?.sheets.includes('明细') &&
              result.workbook.sheets.includes('汇总') &&
              result.workbook.formulas.length > 0 &&
              result.workbook.headerBold &&
              result.workbook.headerHasFill,
            {
              name: 'human-live-create-excel-report',
              message: 'live human 应创建含多 Sheet、公式和基础表头格式的可读 Excel 报表并核对。',
              data: { tools: starts.map((event) => event.toolName), workbook: result.workbook }
            }
          )
        }
      })
    })
  })
})
