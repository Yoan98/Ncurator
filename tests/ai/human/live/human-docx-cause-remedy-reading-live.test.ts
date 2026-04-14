import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_CROSS_FILE_FIXTURE_PATHS,
  HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT,
  resolveSelectedDocxFixtures
} from '../../../harness/backend/aiLiveTestData'
import {
  collectStartedToolStringArgs,
  filterAiRunEventsByType,
  runWithStructuredOutputRetry
} from '../testUtils'

const openedExpectedDoc = (
  openedSourcePaths: readonly string[],
  expectedRelativePath: string,
  expectedName: string
): boolean =>
  openedSourcePaths.some(
    (sourcePath) =>
      sourcePath.endsWith(expectedRelativePath) || sourcePath.endsWith(`/${expectedName}`)
  )

const hasOverfittingRemedyResponse = (deliveryText: string): boolean =>
  /(没写|未写|没有写|文档没写)/.test(deliveryText) ||
  /(数据增强|未使用过的数据|验证数据)/.test(deliveryText)

const hasCompletedDelivery = (output: { summary?: string | null; deliveryMarkdown?: string | null }): boolean =>
  typeof output.summary === 'string' &&
  output.summary.trim().length > 0 &&
  typeof output.deliveryMarkdown === 'string' &&
  output.deliveryMarkdown.trim().length > 0

describe('ai human live backend', () => {
  it('human-docx-cause-remedy-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-cause-remedy-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 会基于两份已选 docx 准确回答过拟合与反走样的成因和处理思路。',
        fixtures: DOCX_CROSS_FILE_FIXTURE_PATHS,
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv('primary')
          ? loadLiveLlmConfigFromEnv('primary').model_name
          : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv('primary')) {
            return {
              skipped: true,
              output: null,
              fixtureDocs: [],
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
          const fixtureDocs = resolveSelectedDocxFixtures(runtime)
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxFixtureReferences(runtime)
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT
          })

          return {
            skipped: false,
            output,
            fixtureDocs,
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human live docx cause/remedy reading case。'
            })
            return
          }

          const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
          const toolNames = toolResults.map((event) => event.toolName)
          const openedSourcePaths = collectStartedToolStringArgs(
            result.events,
            'docx_open',
            'sourcePath'
          )
          const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

          runtime.assertThat(
            hasCompletedDelivery(result.output || {}) &&
              result.fixtureDocs.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              toolNames.some(
                (toolName) =>
                  toolName === 'docx_search' ||
                  toolName === 'docx_outline' ||
                  toolName === 'docx_get_block'
              ) &&
              !toolNames.includes('docx_apply_ops') &&
              !toolNames.includes('docx_save') &&
              !toolNames.includes('docx_render_preview') &&
              !toolNames.includes('docx_validate') &&
              /(过拟合|过度拟合)/.test(deliveryText) &&
              /(记住过多训练数据中的特征值|训练时间过久)/.test(deliveryText) &&
              hasOverfittingRemedyResponse(deliveryText) &&
              /反走样/.test(deliveryText) &&
              /(采样频率低于信号频率|像素.*边界)/.test(deliveryText) &&
              /(低通滤波|多个采样点|多个像素点|多次采样)/.test(deliveryText),
            {
              name: 'human-live-reads-both-selected-docx-and-explains-cause-and-remedy',
              message: 'live human 读 case 应打开两份已选 docx，并准确回答过拟合与反走样的成因和处理思路。',
              data: {
                openedSourcePaths,
                toolNames,
                summary: result.output?.summary,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  }, 600_000)
})
