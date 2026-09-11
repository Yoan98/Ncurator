import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedPdfFixtureReference,
  HUMAN_PDF_VISUAL_READING_USER_INPUT,
  PDF_READING_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const fileHash = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

describe('ai human live backend', () => {
  it('human-pdf-visual-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-pdf-visual-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模型能使用 PDF 页面视觉读取，回答图文结合问题。',
        fixtures: [PDF_READING_FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const primaryConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          const reference = buildSelectedPdfFixtureReference(runtime)
          const beforeHash = await fileHash(reference.absolutePath || '')
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference]
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_PDF_VISUAL_READING_USER_INPUT
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

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('pdf_read_pages') &&
              toolNames.includes('read_image') &&
              result.beforeHash === result.afterHash,
            {
              name: 'human-live-uses-pdf-visual-reading',
              message: 'live human 应使用 PDF 页面视觉读取，回答训练闭环及过度拟合图形差异。',
              data: {
                toolNames
              }
            }
          )
        }
      })
    })
  })
})
