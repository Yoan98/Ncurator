import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { buildBlockIndex, loadDocxBundle } from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import type { JsonObject } from '../../../../../src/shared/types'
import {
  hasLiveLlmConfigInEnv,
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
  return buildBlockIndex(
    bundle.documentDom,
    bundle.relationshipTargets,
    bundle.relationshipTypes,
    bundle.relationshipTargetModes,
    bundle.availableRelationshipTargetIds
  )
    .outline.map((block) => block.text)
    .join('\n')
}

const countDurationEstimates = (text: string): number =>
  text.match(/\d+(?:\s*[-~至到]\s*\d+)?\s*(?:天|人日|工作日|小时)/g)?.length || 0

const visualResultHasError = (data: unknown): boolean => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const results = (data as JsonObject).results
  return (
    Array.isArray(results) &&
    results.some(
      (result) =>
        result &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        typeof (result as JsonObject).error === 'string'
    )
  )
}

describe('ai human live backend', () => {
  it('human-docx-dangling-image-edit-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-dangling-image-edit-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模型可处理带 NULL 图片残留的真实需求 DOCX，并将工时评估写回文档。',
        fixtures: [FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return { skipped: true, output: null, events: [], sourceText: '', appliedText: '' }
          }

          const primaryConfig = loadLiveLlmConfigFromEnv()
          const visionConfig = loadLiveVisionLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          await runtime.seedLlmConfig(visionConfig)
          const reference = buildSelectedDocxFixtureReferences(runtime, [FIXTURE_PATH])[0]!
          const sourceText = await readDocxText(reference.absolutePath || '')
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference],
            visionModel: { configId: visionConfig.id, modelName: visionConfig.model_name },
            allowedToolNames: [
              'docx_read_outline',
              'docx_search',
              'docx_read_blocks',
              'docx_read_visuals',
              'docx_edit'
            ],
            runtimeSettingsOverride: { llmStreamingMode: 'force_non_stream' }
          })
          const output = await runner.run({ taskId: runtime.taskId, userInput: USER_INPUT })
          const artifact = output.artifacts?.find(
            (item) => item.kind === 'file' && item.capability === 'docx'
          )
          const appliedText = artifact?.kind === 'file' ? await readDocxText(artifact.path) : ''
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            sourceText,
            appliedText
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human DOCX 脏图片关系编辑 case。'
            })
            return
          }

          const events = result.events
          const toolStarts = filterAiRunEventsByType(events, 'tool_call_started')
          const toolNames = toolStarts.map((event) => event.toolName)
          const docxEditSucceeded = filterAiRunEventsByType(events, 'tool_call_result').some(
            (event) => event.toolName === 'docx_edit' && event.result?.ok === true
          )
          const visualResults = filterAiRunEventsByType(events, 'tool_call_result').filter(
            (event) => event.toolName === 'docx_read_visuals' && event.result?.ok === true
          )
          const delivery = String(result.output?.deliveryMarkdown || '')
          const appliedDurationCount = countDurationEstimates(result.appliedText)
          const sourceDurationCount = countDurationEstimates(result.sourceText)

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('docx_read_outline') &&
              toolNames.includes('docx_read_blocks') &&
              toolNames.includes('docx_read_visuals') &&
              docxEditSucceeded &&
              result.output?.artifacts?.some(
                (item) => item.kind === 'file' && item.capability === 'docx'
              ) === true &&
              visualResults.length >= 1 &&
              visualResults.every((event) => !visualResultHasError(event.result?.data)) &&
              !/图片\s*9|图片九/.test(delivery) &&
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
                deliveryMarkdown: delivery,
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
