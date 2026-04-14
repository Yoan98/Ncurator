import path from 'node:path'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  hasUnchangedFileBytes,
  HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT,
  seedKbGuidedDocxKb,
  seedKbGuidedDocxWorkspace
} from '../../../harness/backend/aiLiveTestData'
import {
  collectDocxApplyOpsContentKinds,
  collectStartedToolStringArgs,
  filterAiRunEventsByType,
  hasKbToolCall,
  runWithStructuredOutputRetry
} from '../testUtils'

describe('ai human live backend', () => {
  it('human-kb-guided-docx-comparison-draft-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-kb-guided-docx-comparison-draft-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 会先用 KB 缩圈定位课件，再继续对目标 docx 做 confirm-copy 补写。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv('primary')
          ? loadLiveLlmConfigFromEnv('primary').model_name
          : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv('primary')) {
            return {
              skipped: true,
              output: null,
              workspaceSeed: null,
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
          const workspaceSeed = await seedKbGuidedDocxWorkspace(runtime)
          await seedKbGuidedDocxKb(runtime, workspaceSeed)

          const runner = createHumanTestRunner(runtime)
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT
          })

          return {
            skipped: false,
            output,
            workspaceSeed,
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.workspaceSeed) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human live KB-guided docx comparison draft case。'
            })
            return
          }

          const events = result.events
          const toolResults = filterAiRunEventsByType(events, 'tool_call_result')
          const toolNames = toolResults.map((event) => event.toolName)
          const openedSourcePaths = collectStartedToolStringArgs(events, 'docx_open', 'sourcePath')
          const changedContentKinds = collectDocxApplyOpsContentKinds(events)
          const docxArtifacts =
            result.output?.artifacts?.filter(
              (artifact) =>
                artifact.kind === 'file' &&
                artifact.capability === 'docx' &&
                artifact.artifactRole === 'draft'
            ) || []
          const hasDraftReviewArtifact =
            result.output?.artifacts?.some((artifact) => artifact.kind === 'draft_review') || false
          const deepLearningUnchanged = await hasUnchangedFileBytes(
            result.workspaceSeed.deepLearningPath,
            result.workspaceSeed.originalDeepLearningBytes
          )
          const graphicsUnchanged = await hasUnchangedFileBytes(
            result.workspaceSeed.graphicsPath,
            result.workspaceSeed.originalGraphicsBytes
          )
          const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

          runtime.assertThat(
            result.output?.status === 'completed' &&
              hasKbToolCall(events) &&
              toolNames.includes('docx_apply_ops') &&
              docxArtifacts.length > 0 &&
              hasDraftReviewArtifact &&
              changedContentKinds.includes('paragraph') &&
              changedContentKinds.includes('table') &&
              openedSourcePaths.some(
                (sourcePath) =>
                  sourcePath.endsWith(result.workspaceSeed.graphicsRelativePath) ||
                  sourcePath.endsWith(`/${path.basename(result.workspaceSeed.graphicsRelativePath)}`)
              ) &&
              /(过拟合|过度拟合)/.test(deliveryText) &&
              /反走样/.test(deliveryText) &&
              deepLearningUnchanged &&
              graphicsUnchanged,
            {
              name: 'human-live-kb-guided-docx-write-uses-kb-and-preserves-source-files',
              message: 'live human KB-guided 写 case 应先触发 KB 缩圈，再对目标 docx 生成 confirm copy 且不覆盖原文件。',
              data: {
                openedSourcePaths,
                toolNames,
                changedContentKinds,
                summary: result.output?.summary,
                deliveryMarkdown: result.output?.deliveryMarkdown,
                artifacts: result.output?.artifacts
              }
            }
          )
        }
      })
    })
  }, 600_000)
})
