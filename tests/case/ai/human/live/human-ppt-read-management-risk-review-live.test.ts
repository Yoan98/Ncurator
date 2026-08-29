import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/emcation-brand-proposal.pptx' as const
const WORKSPACE_RELATIVE = 'emcation-brand-proposal.pptx'

const hashFile = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

describe('ai human live ppt read backend', () => {
  it('human-ppt-read-management-risk-review-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-ppt-read-management-risk-review-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '审阅品牌提案 PPT 并以对话方式给出简报，且不修改 PPT。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const sourcePath = path.join(runtime.workspaceRoot, WORKSPACE_RELATIVE)
          const beforeHash = await hashFile(sourcePath)
          const eventOffset = runtime.eventCollector.snapshot().length
          const output = await createHumanTestRunner(runtime, {}).run({
            taskId: runtime.taskId,
            userInput: [
              `请审阅工作区中的 ${WORKSPACE_RELATIVE}，为品牌提案会准备口头简报。`,
              '请覆盖：品牌定位与成立背景、核心价值、营销策略重点、目标受众、以及 Metrics & KPIs 页的关键数字（含 85%）。',
              '简报前请先核对 Metrics & KPIs 相关页面。不要修改演示文稿。'
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
              !toolNames.includes('ppt_edit') &&
              toolNames.some((name) => name.startsWith('ppt_read') || name === 'ppt_search'),
            {
              name: 'human-live-ppt-brand-review-uses-real-reading',
              message: 'live 模型应读取品牌提案 PPT 并保持源文件不变。',
              data: { toolNames }
            }
          )
        }
      })
    })
  }, 420_000)
})
