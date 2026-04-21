import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildKbGuidedDocxWorkspaceSeed,
  DOCX_ALL_FIXTURE_PATHS,
  HUMAN_KB_GUIDED_DOCX_READING_USER_INPUT,
  seedKbGuidedDocxKb
} from '../../../../harness/backend/aiLiveTestData'
import {
  collectStartedToolStringArgs,
  filterAiRunEventsByType,
  hasKbToolCall,
  runWithStructuredOutputRetry
} from '../../../../ai/human/testUtils'

describe('temp ai human live backend', () => {
  it('human-kb-guided-docx-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-kb-guided-docx-reading-live',
        harnessMode: 'live',
        domain: 'temp',
        suite: 'ai',
        groups: ['human', 'live'],
        description: '观察 live 模式下 human 在工作区资料较多时，会如何用 KB 缩圈并回答过拟合与反走样的处理思路。',
        fixtures: DOCX_ALL_FIXTURE_PATHS,
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv('primary')
          ? loadLiveLlmConfigFromEnv('primary').model_name
          : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv('primary')) {
            return {
              skipped: true,
              output: null,
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
          const workspaceSeed = await buildKbGuidedDocxWorkspaceSeed(runtime)
          await seedKbGuidedDocxKb(runtime, workspaceSeed)

          const runner = createHumanTestRunner(runtime)
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_KB_GUIDED_DOCX_READING_USER_INPUT
          })

          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 temp human live KB-guided docx reading case。'
            })
            return
          }

          const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
          const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`
          const openedSourcePaths = collectStartedToolStringArgs(
            result.events,
            'docx_open',
            'sourcePath'
          )

          runtime.assertThat(
            result.output?.status === 'completed' &&
              hasKbToolCall(result.events) &&
              /(数据增强|未使用过的数据|验证数据)/.test(deliveryText) &&
              /(低通滤波|多个采样点|多个像素点|多次采样)/.test(deliveryText),
            {
              name: 'temp-human-live-kb-guided-reading-covers-kb-and-answer-facts',
              message: 'temp KB-guided 读 case 应至少触发 KB，并回答过拟合与反走样的处理思路。',
              data: {
                openedSourcePaths,
                toolNames: toolResults.map((event) => event.toolName),
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
