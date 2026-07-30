import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createHandNode } from '../../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool hand excel backend', () => {
  it('hand-excel-read-write-read', async () => {
    await runBackendCase({
      caseId: 'hand-excel-read-write-read',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand', 'excel'],
      description: '验证 hand 顺序执行 Excel 读取、写入和复读。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const workbook = new ExcelJS.Workbook()
        workbook.addWorksheet('Data').addRows([
          ['Item', 'Amount'],
          ['A', 12]
        ])
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'hand-report.xlsx'),
          Buffer.from(await workbook.xlsx.writeBuffer())
        )

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'excel-read'
        })
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'excel-write'
        })
        const initial = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '把 Data 工作表中 A 的金额更新为 20，并确认结果。'
        })
        const state = await createHandNode({ ctx, cache })({
          ...initial,
          skills: { learnedSkillIds: ['excel-read', 'excel-write'] },
          execution: {
            ...initial.execution,
            currentThought: {
              thought: { next: '读取、更新并复读工作簿' },
              nextAction: {
                action: 'hand',
                calls: [
                  { toolName: 'excel_read_outline', args: { sourcePath: 'hand-report.xlsx' } },
                  {
                    toolName: 'excel_edit',
                    args: {
                      sourcePath: 'hand-report.xlsx',
                      actions: [{ type: 'set_cell', sheetName: 'Data', address: 'B2', value: 20 }]
                    }
                  },
                  {
                    toolName: 'excel_read_cells',
                    args: {
                      sourcePath: 'hand-report.xlsx',
                      ranges: [{ sheetName: 'Data', range: 'A1:B2' }]
                    }
                  }
                ]
              }
            }
          }
        })
        return { state }
      },
      assert: async (result, runtime) => {
        const results = result.state.execution.lastToolResults || []
        runtime.assertThat(
          results.map((item) => item.toolName).join(',') ===
            'excel_read_outline,excel_edit,excel_read_cells' &&
            results.every((item) => item.ok) &&
            JSON.stringify(results[2]?.data).includes('20'),
          {
            name: 'hand-excel-serial-chain',
            message: 'hand 应按顺序完成 Excel 读取、写入和复读，且复读可见新值。',
            data: results
          }
        )
      }
    })
  })
})
