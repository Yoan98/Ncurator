import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import type { JsonObject } from '../../../../../src/shared/types'
import {
  loadLiveLlmConfigFromEnv,
  loadLiveVisionLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildSelectedDocxFixtureReferences } from '../../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/docx-visual-kinds.docx' as const

const fileHash = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

const readVisualTexts = (data: unknown): string[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const results = (data as JsonObject).results
  if (!Array.isArray(results)) return []
  return results
    .map((result) =>
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      typeof result.text === 'string'
        ? result.text
        : ''
    )
    .filter(Boolean)
}

describe('ai human live backend', () => {
  it('human-docx-visual-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-visual-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        requiresVisionModel: true,
        description: '验证 live 模型能从 DOCX 递归 visual 节点自主读取普通图片。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const primaryConfig = loadLiveLlmConfigFromEnv()
          const visionConfig = loadLiveVisionLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          await runtime.seedLlmConfig(visionConfig)
          const reference = buildSelectedDocxFixtureReferences(runtime, [FIXTURE_PATH])[0]!
          const beforeHash = await fileHash(reference.absolutePath || '')
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference],
            visionModel: {
              configId: visionConfig.id,
              modelName: visionConfig.model_name
            },
            runtimeSettingsOverride: {
              llmStreamingMode: 'force_non_stream'
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput:
              '请只根据我选中的 Word 文档，找到其中标有 IMAGE 的普通图片并读图，告诉我图片里的英文标题、主要颜色和三个基本图形。不要分析图表、关系图、形状或嵌入对象，也不要修改文件。'
          })
          return {
            output,
            events: runtime.eventCollector.snapshot(),
            beforeHash,
            afterHash: await fileHash(reference.absolutePath || '')
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const toolNames = starts.map((event) => event.toolName)
          const visualTexts = filterAiRunEventsByType(result.events, 'tool_call_result')
            .filter((event) => event.toolName === 'docx_read_visuals' && event.result?.ok === true)
            .flatMap((event) => readVisualTexts(event.result?.data))
          const analyzeTexts = filterAiRunEventsByType(result.events, 'tool_call_result')
            .filter((event) => event.toolName === 'image_analyze' && event.result?.ok === true)
            .map((event) => {
              const data = event.result?.data
              return typeof data === 'string'
                ? data
                : String((data as { result?: unknown } | null | undefined)?.result || '')
            })
            .filter((text) => text.trim().length > 0)

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('docx_read') &&
              [...visualTexts, ...analyzeTexts].some((text) => /IMAGE/i.test(text)) &&
              !toolNames.some((toolName) =>
                [
                  'docx_content_edit',
                  'docx_format',
                  'docx_table_edit',
                  'docx_media_edit',
                  'docx_comments_revisions'
                ].includes(toolName)
              ) &&
              result.beforeHash === result.afterHash,
            {
              name: 'human-live-reads-docx-image-from-recursive-visual-node',
              message: 'live human 应自主读取 DOCX 中的普通图片并准确回答可见内容。',
              data: {
                toolNames,
                visualTexts,
                sourceUnchanged: result.beforeHash === result.afterHash
              }
            }
          )
        }
      })
    })
  })
})
