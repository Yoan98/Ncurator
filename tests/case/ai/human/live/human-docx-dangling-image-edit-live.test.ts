import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import type { JsonObject } from '../../../../../src/shared/types'
import {
  loadLiveLlmConfigFromEnv,
  loadLiveVisionLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { buildSelectedDocxFixtureReferences } from '../../../../harness/backend/aiLiveTestData'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const FIXTURE_PATH = 'tests/fixtures/workspace/灵感活动设计 需求.docx' as const
const USER_INPUT =
  '帮我评估下这个需求的每个点的开发时间，然后帮我补在对应地方；然后跟我讲下有哪些需求以及是否有啥图片及图片内容里说的啥'

const readDocxText = async (filePath: string): Promise<string> => {
  const bundle = await loadDocxBundle(await fs.readFile(filePath))
  return buildDocumentNodeIndex(bundle)
    .outline.map((node) => node.text)
    .join('\n')
}

const countDurationEstimates = (text: string): number =>
  text.match(/\d+(?:\s*[-~至到]\s*\d+)?\s*(?:天|人日|工作日|小时)/g)?.length || 0

const visualResultItems = (data: unknown): JsonObject[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const results = (data as JsonObject).results
  if (!Array.isArray(results)) return []
  return results.filter((result): result is JsonObject =>
    Boolean(result && typeof result === 'object' && !Array.isArray(result))
  )
}

const visualResultHasText = (data: unknown): boolean =>
  visualResultItems(data).some(
    (result) => typeof result.text === 'string' && result.text.length > 0
  )

const visualResultHasMissingMediaError = (data: unknown): boolean =>
  visualResultItems(data).some(
    (result) =>
      typeof result.error === 'string' &&
      /visual media is missing|missing relationship target|(?:^|\W)null(?:\W|$)/i.test(result.error)
  )

describe('ai human live backend', () => {
  it('human-docx-dangling-image-edit-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-dangling-image-edit-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        requiresVisionModel: true,
        description: '验证 live 模型可处理带 NULL 图片残留的真实需求 DOCX，并将工时评估写回文档。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const primaryConfig = loadLiveLlmConfigFromEnv()
          const visionConfig = loadLiveVisionLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          await runtime.seedLlmConfig(visionConfig)
          const reference = buildSelectedDocxFixtureReferences(runtime, [FIXTURE_PATH])[0]!
          const sourceText = await readDocxText(reference.absolutePath || '')
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference],
            visionModel: { configId: visionConfig.id, modelName: visionConfig.model_name },
            runtimeSettingsOverride: { llmStreamingMode: 'force_non_stream' }
          })
          const output = await runner.run({ taskId: runtime.taskId, userInput: USER_INPUT })
          const applyRecord = (await runtime.docxApplyStore.listRecords()).items.find(
            (item) => item.run_id === runtime.runId && item.status === 'applied'
          )
          const appliedText = applyRecord ? await readDocxText(reference.absolutePath || '') : ''
          return {
            output,
            events: runtime.eventCollector.snapshot(),
            sourceText,
            appliedText
          }
        },
        assert: async (result, runtime) => {
          const events = result.events
          const toolStarts = filterAiRunEventsByType(events, 'tool_call_started')
          const toolNames = toolStarts.map((event) => event.toolName)
          const docxEditSucceeded = filterAiRunEventsByType(events, 'tool_call_result').some(
            (event) => event.toolName === 'docx_content_edit' && event.result?.ok === true
          )
          const visualResults = filterAiRunEventsByType(events, 'tool_call_result').filter(
            (event) => event.toolName === 'docx_read_visuals' && event.result?.ok === true
          )
          const appliedDurationCount = countDurationEstimates(result.appliedText)
          const sourceDurationCount = countDurationEstimates(result.sourceText)

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('docx_read_outline') &&
              toolNames.includes('docx_read_nodes') &&
              toolNames.includes('docx_read_visuals') &&
              docxEditSucceeded &&
              result.output?.artifacts?.some(
                (item) => item.kind === 'file' && item.capability === 'docx'
              ) === true &&
              result.appliedText.length > 0 &&
              visualResults.length >= 1 &&
              visualResults.some((event) => visualResultHasText(event.result?.data)) &&
              visualResults.every(
                (event) => !visualResultHasMissingMediaError(event.result?.data)
              ) &&
              appliedDurationCount >= 12 &&
              appliedDurationCount > sourceDurationCount,
            {
              name: 'human-live-edits-dangling-image-docx-with-all-estimates',
              message:
                'live human 应忽略 NULL 图片残留，读取真实图片，并将 13 项需求中的有效开发时间写入 DOCX。',
              data: {
                toolNames,
                docxEditSucceeded,
                visualResultCount: visualResults.length,
                sourceDurationCount,
                appliedDurationCount,
                artifacts: result.output?.artifacts
              }
            }
          )
        }
      })
    })
  })
})
