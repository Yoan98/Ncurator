import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildKbGuidedDocxWorkspaceSeed,
  HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../harness/backend/aiLiveTestData'
import {
  collectDocxApplyOpsContentKinds,
  countDraftFileArtifacts,
  countFileReviewArtifacts,
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
        description: '验证 live 模式下 human 会先用 KB 缩圈定位相关课件，再把内容回写到另外两份目标 docx。',
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
              indexedFiles: [],
              workspaceSeed: null,
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const workspaceSeed = await buildKbGuidedDocxWorkspaceSeed(runtime)
          const indexedFiles = await runtime.seedWorkspaceKb({
            mode: 'all-supported'
          })

          const runner = createHumanTestRunner(runtime, {
            runtimeSettingsOverride: {
              llmStreamingMode: 'force_non_stream'
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT
          })

          return {
            skipped: false,
            output,
            indexedFiles,
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
          const indexedSupportedFiles = result.indexedFiles.filter(
            (file) => file.supported && file.status === 'indexed'
          )
          const openedSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName.startsWith('docx_'))
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const writeSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) =>
              event.toolName === 'docx_paragraph_edit' ||
              event.toolName === 'docx_heading_edit' ||
              event.toolName === 'docx_table_edit' ||
              event.toolName === 'docx_text_edit' ||
              event.toolName === 'docx_text_style_edit'
            )
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const changedContentKinds = collectDocxApplyOpsContentKinds(events)
          const targetDocsWritten = result.workspaceSeed.targetDocs.every(
            (fixtureDoc) =>
              writeSourcePaths.some(
                (sourcePath) =>
                  sourcePath.endsWith(fixtureDoc.relativePath) ||
                  sourcePath.endsWith(`/${path.basename(fixtureDoc.relativePath)}`)
              )
          )
          const sourceDocsUnchanged = await Promise.all(
            result.workspaceSeed.trackedDocs.map(async (fixture) => {
              const currentBytes = await fs.readFile(fixture.workspacePath)
              return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
            })
          )
          const deliveryText = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              hasKbToolCall(events) &&
              toolNames.some((toolName) => toolName.endsWith('_edit')) &&
              changedContentKinds.includes('paragraph') &&
              targetDocsWritten &&
              filterAiRunEventsByType(events, 'draft_review_ready').length >= 2 &&
              countFileReviewArtifacts(result.output?.artifacts) >= 2 &&
              countDraftFileArtifacts(result.output?.artifacts) >= 2 &&
              /(过拟合|过度拟合)/.test(deliveryText) &&
              /反走样/.test(deliveryText) &&
              /PRD|课堂|案例/.test(deliveryText) &&
              sourceDocsUnchanged.every(Boolean) &&
              indexedSupportedFiles.length === 8 &&
              typeof result.output?.deliveryMarkdown === 'string' &&
              result.output.deliveryMarkdown.trim().length > 0,
            {
              name: 'human-live-kb-guided-docx-updates-two-target-docs-from-kb-grounded-evidence',
              message: 'live human KB-guided 写 case 应先触发 KB 缩圈，再把 grounded 内容落到两份目标 docx 上且不覆盖原文件。',
              data: {
                openedSourcePaths,
                writeSourcePaths,
                toolNames,
                indexedSupportedFiles,
                changedContentKinds,
                deliveryMarkdown: result.output?.deliveryMarkdown,
                artifacts: result.output?.artifacts
              }
            }
          )
        }
      })
    })
  }, 900_000)
})
