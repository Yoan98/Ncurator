import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_READING_FIXTURE_PATHS,
  HUMAN_DOCX_CAUSE_REMEDY_READING_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH,
  resolveSelectedDocxFixtures
} from '../../../harness/backend/aiLiveTestData'
import {
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

const hasCompletedDelivery = (output: { summary?: string | null; deliveryMarkdown?: string | null }): boolean =>
  typeof output.summary === 'string' &&
  output.summary.trim().length > 0 &&
  typeof output.deliveryMarkdown === 'string' &&
  output.deliveryMarkdown.trim().length > 0

const hasOverfittingRemedyResponse = (deliveryText: string): boolean =>
  /(没写|未写|没有写|文档没写|未提及|未说明|没有提到|未给出|未提供)/.test(deliveryText) ||
  /(文档中未提及处理方法|文档未提及处理方法|文档中未说明处理方法|文档未说明处理方法)/.test(
    deliveryText
  ) ||
  /(数据增强|未使用过的数据|训练时未使用过的数据|验证数据)/.test(deliveryText)

describe('ai human live backend', () => {
  it('human-docx-cause-remedy-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-cause-remedy-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 会基于两份已选 docx 覆盖过拟合与反走样的核心事实，并对缺失项保持保守。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv()
          ? loadLiveLlmConfigFromEnv().model_name
          : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              fixtureDocs: [],
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const fixtureDocs = resolveSelectedDocxFixtures(runtime, DOCX_READING_FIXTURE_PATHS)
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxFixtureReferences(runtime, DOCX_READING_FIXTURE_PATHS)
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
          const openedSourcePaths = filterAiRunEventsByType(result.events, 'tool_call_started')
            .filter(
              (event) =>
                event.toolName === 'docx_search' ||
                event.toolName === 'docx_outline' ||
                event.toolName === 'docx_read_blocks' ||
                event.toolName === 'docx_history'
            )
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

          runtime.assertThat(
            hasCompletedDelivery(result.output || {}) &&
              result.fixtureDocs.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              toolNames.some((toolName) => toolName === 'docx_search') &&
              toolNames.some((toolName) => toolName === 'docx_read_blocks' || toolName === 'docx_outline') &&
              !toolNames.some((toolName) => toolName.endsWith('_edit')) &&
              /(过拟合|过度拟合)/.test(deliveryText) &&
              /(记住过多训练数据中的特征值|训练时间过久)/.test(deliveryText) &&
              hasOverfittingRemedyResponse(deliveryText) &&
              /反走样/.test(deliveryText) &&
              /(采样频率低于信号频率|像素.*边界)/.test(deliveryText) &&
              /(低通滤波|多个采样点|多个像素点|多次采样)/.test(deliveryText),
            {
              name: 'human-live-reads-both-selected-docx-and-explains-cause-and-remedy',
              message:
                'live human 读 case 应打开两份已选 docx，覆盖过拟合与反走样的核心事实，并对文档未写部分保持保守表达。',
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
