import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv,
  loadLiveVisionLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedPdfFixtureReference,
  HUMAN_PDF_VISUAL_READING_USER_INPUT,
  PDF_READING_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'
import type { JsonObject } from '../../../../../src/shared/types'

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
  it('human-pdf-visual-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-pdf-visual-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模型能自主组合 PDF 文本读取和页面视觉读取，回答图文结合问题。',
        fixtures: [PDF_READING_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return { skipped: true, output: null, events: [], beforeHash: '', afterHash: '' }
          }

          const primaryConfig = loadLiveLlmConfigFromEnv()
          const visionConfig = loadLiveVisionLlmConfigFromEnv()
          await runtime.seedLlmConfig(primaryConfig)
          await runtime.seedLlmConfig(visionConfig)
          const reference = buildSelectedPdfFixtureReference(runtime)
          const beforeHash = await fileHash(reference.absolutePath || '')
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference],
            visionModel: {
              configId: visionConfig.id,
              modelName: visionConfig.model_name
            },
            allowedToolNames: [
              'pdf_inspect',
              'pdf_search',
              'pdf_read_pages',
              'pdf_read_visuals'
            ]
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_PDF_VISUAL_READING_USER_INPUT
          })
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            beforeHash,
            afterHash: await fileHash(reference.absolutePath || '')
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human PDF 图文阅读 live case。'
            })
            return
          }

          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const results = filterAiRunEventsByType(result.events, 'tool_call_result')
          const toolNames = starts.map((event) => event.toolName)
          const visualTexts = results
            .filter((event) => event.toolName === 'pdf_read_visuals' && event.result?.ok === true)
            .flatMap((event) => readVisualTexts(event.result?.data))
          const failedVisualCount = results.filter(
            (event) => event.toolName === 'pdf_read_visuals' && event.result?.ok === false
          ).length
          const delivery = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              toolNames.includes('pdf_read_pages') &&
              toolNames.includes('pdf_read_visuals') &&
              visualTexts.some((text) => /Proper fit/i.test(text) || /Overfit/i.test(text)) &&
              failedVisualCount === 0 &&
              !toolNames.some(
                (name) =>
                  name === 'terminal_run' ||
                  name.startsWith('kb_') ||
                  name.startsWith('docx_') ||
                  name === 'pdf_render_pages' ||
                  name === 'image_analyze'
              ) &&
              /(inputs|输入)/i.test(delivery) &&
              /(parameters|参数)/i.test(delivery) &&
              /(loss|损失)/i.test(delivery) &&
              /(update|更新)/i.test(delivery) &&
              /Proper fit/i.test(delivery) &&
              /Overfit/i.test(delivery) &&
              /(训练.*验证|验证.*训练|泛化|间距|差距)/i.test(delivery) &&
              !/(无法|不能|不支持).{0,12}(看到|识别|读取).{0,8}(图片|图像|曲线)/i.test(delivery) &&
              result.beforeHash === result.afterHash,
            {
              name: 'human-live-composes-pdf-text-and-visual-reading',
              message:
                'live human 应自主组合 PDF 文本阅读和页面视觉读取，回答训练闭环及过度拟合图形差异。',
              data: {
                toolNames,
                visualTexts,
                failedVisualCount,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  })
})
