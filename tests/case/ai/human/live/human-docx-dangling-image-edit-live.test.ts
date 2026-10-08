import { assertRunFileReviews } from '../../../../harness/backend/fileReviewAssertions'
import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
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
  text.match(/\d+(?:\.\d+)?(?:\s*[-~至到]\s*\d+(?:\.\d+)?)?\s*(?:人天|人日|工作日|小时|天)/g)
    ?.length || 0

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
        execute: async (runtime) => {
          const primaryConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          const reference = buildSelectedDocxFixtureReferences(runtime, [FIXTURE_PATH])[0]!
          const sourceText = await readDocxText(reference.absolutePath || '')
          const runner = await createAiServiceTestRunner(runtime, {
            selectedReferences: [reference],
            streamingModeOverride: 'force_non_stream',
            userInput: USER_INPUT
          })
          const output = await runner.run()
          await assertRunFileReviews(runtime, output)
          const applyRecord = (
            await runtime.storageService.aiFileChange.listRecords({ runId: runtime.runId })
          ).items.find((item) => item.path === reference.absolutePath && item.status === 'applied')
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
          const appliedDurationCount = countDurationEstimates(result.appliedText)
          const sourceDurationCount = countDurationEstimates(result.sourceText)

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('docx_read_outline') &&
              toolNames.some((name) => name === 'docx_read_nodes' || name === 'docx_search') &&
              toolNames.includes('read_image') &&
              docxEditSucceeded &&
              result.output?.finalArtifacts?.some(
                (item) => item.kind === 'file' && item.capability === 'docx'
              ) === true &&
              result.appliedText.length > 0 &&
              appliedDurationCount >= 12 &&
              appliedDurationCount > sourceDurationCount,
            {
              name: 'human-live-edits-dangling-image-docx-with-all-estimates',
              message:
                'live human 应忽略 NULL 图片残留，读取真实图片，并将 13 项需求中的有效开发时间写入 DOCX。',
              data: {
                toolNames,
                docxEditSucceeded,
                sourceDurationCount,
                appliedDurationCount,
                artifacts: result.output?.finalArtifacts
              }
            }
          )
        }
      })
    })
  }, 1_800_000)
})
