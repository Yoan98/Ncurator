import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxReferences,
  captureDocxFixtureBytes,
  DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS,
  DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH,
  HUMAN_DOCX_CROSS_SOURCE_SUMMARY_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH,
  resolveSelectedDocxFixtures
} from '../../../harness/backend/aiLiveTestData'
import {
  collectDocxApplyOpsContentKinds,
  filterAiRunEventsByType,
  hasDraftFileArtifact,
  hasFileReviewArtifact,
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

describe('ai human live backend', () => {
  it('human-docx-cross-source-summary-draft-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-cross-source-summary-draft-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 会读取两份已选课件，自主创建总结 docx 并写入跨源总结。',
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
              workspaceSeed: null,
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const workspaceSeed = {
            sourceDocs: resolveSelectedDocxFixtures(runtime, DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS),
            trackedDocs: await captureDocxFixtureBytes(runtime, DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS)
          }
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxReferences(workspaceSeed.sourceDocs)
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_DOCX_CROSS_SOURCE_SUMMARY_USER_INPUT
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
              message: '未提供 live 模型配置，已跳过 human live cross-source summary draft case。'
            })
            return
          }

          const events = result.events
          const toolResults = filterAiRunEventsByType(events, 'tool_call_result')
          const toolNames = toolResults.map((event) => event.toolName)
          const openedSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName.startsWith('docx_'))
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const createSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName === 'docx_create')
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
          const targetExistsInWorkspace = await fs
            .access(
              `${runtime.workspaceRoot}/${DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH}`
            )
            .then(() => true)
            .catch(() => false)
          const unchangedFixtures = await Promise.all(
            result.workspaceSeed.trackedDocs.map(async (fixture) => {
              const currentBytes = await fs.readFile(fixture.workspacePath)
              return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
            })
          )
          const deliveryText = String(result.output?.deliveryMarkdown || '')
          const sourceDocsOpened = result.workspaceSeed.sourceDocs.every((fixtureDoc) =>
            openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
          )
          const targetDocOpened = openedExpectedDoc(
            openedSourcePaths,
            DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH,
            DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH
          )
          const targetDocCreated =
            createSourcePaths.length >= 1 &&
            createSourcePaths.every((sourcePath) =>
              sourcePath.endsWith(DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH)
            )
          const targetDocWritten =
            writeSourcePaths.length === 0 ||
            writeSourcePaths.every(
              (sourcePath) =>
                sourcePath.endsWith(DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH)
            )

          runtime.assertThat(
            result.output?.status === 'completed' &&
              sourceDocsOpened &&
              targetDocCreated &&
              targetDocOpened &&
              toolNames.some((toolName) => toolName === 'docx_search' || toolName === 'docx_read_blocks') &&
              toolNames.includes('docx_create') &&
              targetDocWritten &&
              filterAiRunEventsByType(events, 'draft_review_ready').length >= 1 &&
              hasFileReviewArtifact(result.output?.artifacts) &&
              hasDraftFileArtifact(result.output?.artifacts) &&
              unchangedFixtures.every(Boolean) &&
              targetExistsInWorkspace === false &&
              /(过拟合|过度拟合)/.test(deliveryText) &&
              /反走样/.test(deliveryText) &&
              /总结|报告/.test(deliveryText),
            {
              name: 'human-live-cross-source-summary-writes-only-new-report-doc',
              message:
                'live human cross-source summary case 应读取两份源课件，自主创建总结 docx，并且只把总结写到这份新文件上。',
              data: {
                openedSourcePaths,
                createSourcePaths,
                writeSourcePaths,
                toolNames,
                targetReportPath: DOCX_CROSS_SOURCE_SUMMARY_REPORT_RELATIVE_PATH,
                changedContentKinds,
                targetExistsInWorkspace,
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
