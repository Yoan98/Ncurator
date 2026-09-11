import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent, JsonObject, JsonValue } from '../../../../../src/shared/types'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildKbGuidedDocxWorkspaceSeed,
  HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../../harness/backend/aiLiveTestData'
import {
  collectDocxWriteContentKinds,
  collectStartedDocxWriteSourcePaths,
  countDocxApplyArtifacts,
  countDocxFileArtifacts,
  filterAiRunEventsByType,
  hasKbToolCall,
  isDocxWriteInput
} from '../testUtils'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const DOCX_WRITE_TOOL_NAMES = new Set([
  'docx_content_edit',
  'docx_format',
  'docx_table_edit',
  'docx_comments_revisions'
])
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
      runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
      execute: async (runtime) => {
        if (!loadLiveLlmConfigFromEnv()) {
          return {
            configurationMissing: true,
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
          runtimeSettingsOverride: {
            llmStreamingMode: 'force_non_stream'
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: HUMAN_KB_GUIDED_DOCX_COMPARISON_DRAFT_USER_INPUT
        })

        return {
          configurationMissing: false,
          output,
          indexedFiles,
          workspaceSeed,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        if (result.configurationMissing || !result.workspaceSeed) {
          runtime.assertThat(false, {
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
        const writeSourcePaths = collectStartedDocxWriteSourcePaths(events, isDocxWriteInput)
        const writeResultsAreMinimal = toolResults
          .filter((event) => DOCX_WRITE_TOOL_NAMES.has(event.toolName) && event.result?.ok === true)
          .every((event) => {
            const data = event.result?.data
            return (
              isJsonObject(data) &&
              !('changes' in data) &&
              Object.keys(data).every((key) => key === 'createdIds')
            )
          })
        const changedContentKinds = collectDocxWriteContentKinds(events)
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
        const kbEvidenceSatisfied =
          hasKbToolCall(events) && hasSuccessfulKbSearchHit(events) && requiredFilesIndexed
        const writtenTargetCount = result.workspaceSeed.targetDocs.filter((fixtureDoc) =>
          writeSourcePaths.some(
            (sourcePath) =>
              sourcePath.endsWith(fixtureDoc.relativePath) ||
              sourcePath.endsWith(`/${path.basename(fixtureDoc.relativePath)}`)
          )
        ).length
        const groundedContentSatisfied = changedContentKinds.includes('paragraph')
        const deliverySatisfied =
          result.output?.status === 'completed' &&
          filterAiRunEventsByType(events, 'file_artifact').filter(
            (event) => event.capability === 'docx' && Boolean(event.applyId)
          ).length >= 2 &&
          countDocxApplyArtifacts(result.output?.artifacts) >= 2 &&
          countDocxFileArtifacts(result.output?.artifacts) >= 2
        runtime.assertThat(
          kbEvidenceSatisfied &&
            writtenTargetCount === result.workspaceSeed.targetDocs.length &&
            groundedContentSatisfied &&
            writeResultsAreMinimal &&
            sourceDocsUnchanged.every(Boolean) &&
            deliverySatisfied,
          {
            name: 'human-live-kb-guided-docx-updates-two-target-docs-from-kb-grounded-evidence',
            message:
              'live KB-guided DOCX case 应基于 KB 检索证据完成两份目标文档的写入交付，并保持来源文件不变。',
            data: {
              openedSourcePaths,
              writeSourcePaths,
              writeResultsAreMinimal,
              toolNames,
              sourceDocRelativePaths: [...sourceDocRelativePaths],
              sourceDocsUnchanged,
              requiredIndexedRelativePaths,
              indexedSupportedFiles,
              changedContentKinds,
              artifacts: result.output?.artifacts
            }
          }
        )
      }
    })
  })
})
