import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent, JsonObject, JsonValue } from '../../../../../src/shared/types'
import {
  loadLiveLlmConfigFromEnv,
  hasLiveLlmConfigInEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildKbGuidedDocxWorkspaceSeed,
  HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import {
  collectDocxApplyOpsContentKinds,
  collectStartedDocxEditSourcePaths,
  countDocxApplyArtifacts,
  countDocxFileArtifacts,
  filterAiRunEventsByType,
  hasKbToolCall,
  isDocxEditWriteInput,
  runWithStructuredOutputRetry
} from '../testUtils'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasSuccessfulKbSearchHit = (events: readonly AiRunEvent[]): boolean =>
  events.some((event) => {
    if (event.type !== 'tool_call_result' || event.toolName !== 'kb_search') return false
    const data = event.result?.data
    if (!isJsonObject(data)) return false
    const total = data.total
    const items = data.items
    return (typeof total === 'number' && total > 0) || (Array.isArray(items) && items.length > 0)
  })

describe('ai human live backend', () => {
  it('human-kb-guided-docx-comparison-draft-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-kb-guided-docx-comparison-draft-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下 human 会先用 KB 缩圈定位相关课件，再把内容回写到另外两份目标 docx。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
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
            mode: 'include-only',
            relativePaths: workspaceSeed.sourceDocs.map((fixture) => fixture.relativePath)
          })
          const indexedSupportedFiles = indexedFiles.filter(
            (file) => file.supported && file.status === 'indexed'
          )
          runtime.assertThat(
            workspaceSeed.sourceDocs.every((fixture) =>
              indexedSupportedFiles.some((file) => file.relativePath === fixture.relativePath)
            ),
            {
              name: 'human-live-kb-guided-source-docs-indexed',
              message: 'KB-guided live case 的两份来源课件必须先完成索引。',
              data: { indexedFiles }
            }
          )

          const runner = createHumanTestRunner(runtime, {
            allowedToolNames: [
              'terminal_run',
              'kb_search',
              'docx_outline',
              'docx_search',
              'docx_read_blocks',
              'docx_edit'
            ],
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
              message:
                '未提供 live 模型配置，已跳过 human live KB-guided docx comparison draft case。'
            })
            return
          }

          const events = result.events
          const toolResults = filterAiRunEventsByType(events, 'tool_call_result')
          const toolNames = toolResults.map((event) => event.toolName)
          const indexedSupportedFiles = result.indexedFiles.filter(
            (file) => file.supported && file.status === 'indexed'
          )
          const requiredIndexedRelativePaths = result.workspaceSeed.sourceDocs.map(
            (fixture) => fixture.relativePath
          )
          const requiredFilesIndexed = requiredIndexedRelativePaths.every((relativePath) =>
            indexedSupportedFiles.some((file) => file.relativePath === relativePath)
          )
          const openedSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName.startsWith('docx_'))
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const writeSourcePaths = collectStartedDocxEditSourcePaths(events, isDocxEditWriteInput)
          const changedContentKinds = collectDocxApplyOpsContentKinds(events)
          const sourceDocRelativePaths = new Set(
            result.workspaceSeed.sourceDocs.map((fixture) => fixture.relativePath)
          )
          const sourceDocsUnchanged = await Promise.all(
            result.workspaceSeed.trackedDocs
              .filter((fixture) => sourceDocRelativePaths.has(fixture.relativePath))
              .map(async (fixture) => {
                const currentBytes = await fs.readFile(fixture.workspacePath)
                return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
              })
          )
          const deliveryText = String(result.output?.deliveryMarkdown || '')
          const kbEvidenceSatisfied =
            hasKbToolCall(events) && hasSuccessfulKbSearchHit(events) && requiredFilesIndexed
          const writtenTargetCount = result.workspaceSeed.targetDocs.filter((fixtureDoc) =>
            writeSourcePaths.some(
              (sourcePath) =>
                sourcePath.endsWith(fixtureDoc.relativePath) ||
                sourcePath.endsWith(`/${path.basename(fixtureDoc.relativePath)}`)
            )
          ).length
          const groundedContentSatisfied =
            changedContentKinds.includes('paragraph') &&
            /(过拟合|过度拟合)/.test(deliveryText) &&
            /反走样/.test(deliveryText) &&
            /PRD|课堂|案例/.test(deliveryText)
          const deliverySatisfied =
            result.output?.status === 'completed' &&
            filterAiRunEventsByType(events, 'file_artifact').filter(
              (event) => event.capability === 'docx' && Boolean(event.applyId)
            ).length >= 2 &&
            countDocxApplyArtifacts(result.output?.artifacts) >= 2 &&
            countDocxFileArtifacts(result.output?.artifacts) >= 2 &&
            typeof result.output?.deliveryMarkdown === 'string' &&
            result.output.deliveryMarkdown.trim().length > 0
          const scoreParts = {
            kbEvidence: kbEvidenceSatisfied ? 2 : 0,
            targetDocuments: writtenTargetCount * 2,
            groundedContent: groundedContentSatisfied ? 2 : 0,
            sourceSafety: sourceDocsUnchanged.every(Boolean) ? 1 : 0,
            finalDelivery: deliverySatisfied ? 1 : 0
          }
          const score = Object.values(scoreParts).reduce((total, value) => total + value, 0)

          runtime.assertThat(score > 8, {
            name: 'human-live-kb-guided-docx-updates-two-target-docs-from-kb-grounded-evidence',
            message:
              'live KB-guided DOCX case 按 10 分制评估 KB 证据、两份目标文件、内容质量、来源安全和最终交付，得分必须严格超过 8 分。',
            data: {
              score,
              scoreParts,
              openedSourcePaths,
              writeSourcePaths,
              toolNames,
              sourceDocRelativePaths: [...sourceDocRelativePaths],
              sourceDocsUnchanged,
              requiredIndexedRelativePaths,
              indexedSupportedFiles,
              changedContentKinds,
              deliveryMarkdown: result.output?.deliveryMarkdown,
              artifacts: result.output?.artifacts
            }
          })
        }
      })
    })
  })
})
