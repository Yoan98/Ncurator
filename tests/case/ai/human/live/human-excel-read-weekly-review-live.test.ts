import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/operating-review.xlsx' as const
const WORKSPACE_RELATIVE = 'operating-review.xlsx'

const hashFile = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

describe('ai human live excel read backend', () => {
  it('human-excel-read-weekly-review-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-excel-read-weekly-review-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '周会前审阅经营工作簿，讲清表结构、关键公式和异常数字，且不改文件。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, WORKSPACE_RELATIVE)
          const beforeHash = await hashFile(sourcePath)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput: [
              `请审阅工作区中的 ${WORKSPACE_RELATIVE}，为销售周会准备口头简报。`,
              '请讲清有哪些工作表、Orders/Targets/Summary 怎么对应、Summary 里的关键公式，以及异常数字（尤其 P-300 实际销售额和退货）。',
              '不要修改工作簿。'
            ].join('')
          })
          return {
            output,
            beforeHash,
            afterHash: await hashFile(sourcePath),
            events: runtime.eventCollector.snapshot().slice(eventOffset)
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          runtime.assertThat(
            result.output.status === 'completed' &&
              result.beforeHash === result.afterHash &&
              toolNames.includes('excel_read') &&
              !toolNames.includes('excel_edit'),
            {
              name: 'human-live-excel-weekly-review-read-only',
              message: 'live 模型应读取经营工作簿并保持源文件不变。',
              data: { toolNames }
            }
          )
        }
      })
    })
  })
})
