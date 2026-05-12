import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_POSITIONED_FIXTURE_PATHS,
  HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH,
  resolveSelectedDocxFixtures
} from '../../../harness/backend/aiLiveTestData'
import {
  countDraftFileArtifacts,
  countFileReviewArtifacts,
  collectToolDiagnosticMessages,
  filterAiRunEventsByType,
  runWithStructuredOutputRetry
} from '../testUtils'

const POSITIONED_FALLBACK_SUPPLEMENT_RELATIVE_PATH = '学习笔记/图形学-反走样补充说明.docx'

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
  it('human-docx-positioned-structural-edit-fallback-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-positioned-structural-edit-fallback-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下 human 在复杂 positioned docx 中命中写入需求时不会自动编辑，而是优雅回退并给出手动补充建议。',
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
              originalFixtureBytes: [],
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const fixtureDocs = resolveSelectedDocxFixtures(runtime, DOCX_POSITIONED_FIXTURE_PATHS)
          const originalFixtureBytes = await Promise.all(
            fixtureDocs.map(async (fixtureDoc) => ({
              name: fixtureDoc.name,
              relativePath: fixtureDoc.relativePath,
              workspacePath: fixtureDoc.workspacePath,
              bytes: await fs.readFile(fixtureDoc.workspacePath)
            }))
          )
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxFixtureReferences(
              runtime,
              DOCX_POSITIONED_FIXTURE_PATHS
            )
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT
          })

          return {
            skipped: false,
            output,
            fixtureDocs,
            originalFixtureBytes,
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human live positioned structural edit fallback case。'
            })
            return
          }

          const events = result.events
          const openedSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName.startsWith('docx_'))
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const structuralStarted = filterAiRunEventsByType(events, 'tool_call_started').filter(
            (event) =>
              (event.toolName === 'docx_paragraph_edit' ||
                event.toolName === 'docx_heading_edit' ||
                event.toolName === 'docx_table_edit' ||
                event.toolName === 'docx_text_edit' ||
                event.toolName === 'docx_text_style_edit') &&
              typeof event.input.sourcePath === 'string'
          )
          const writeResults = filterAiRunEventsByType(events, 'tool_call_result').filter((event) =>
            event.toolName === 'docx_paragraph_edit' ||
            event.toolName === 'docx_heading_edit' ||
            event.toolName === 'docx_table_edit' ||
            event.toolName === 'docx_text_edit' ||
            event.toolName === 'docx_text_style_edit'
          )
          const createSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName === 'docx_create')
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const successfulWriteResults = writeResults.filter((event) => event.result?.ok === true)
          const failedWriteResults = writeResults.filter((event) => event.result?.ok === false)
          const watchHints = filterAiRunEventsByType(events, 'watch_hint')
          const diagnosticMessages = collectToolDiagnosticMessages(events)
          const draftReviewArtifactCount = countFileReviewArtifacts(result.output?.artifacts)
          const draftFileArtifactCount = countDraftFileArtifacts(result.output?.artifacts)
          const createdIndependentSupplement =
            createSourcePaths.length >= 1 &&
            createSourcePaths.every((sourcePath) =>
              sourcePath.endsWith(POSITIONED_FALLBACK_SUPPLEMENT_RELATIVE_PATH)
            )
          const independentSupplementArtifactsValid =
            draftReviewArtifactCount === 1 && draftFileArtifactCount === 1
          const noSupplementArtifacts = draftReviewArtifactCount === 0 && draftFileArtifactCount === 0
          const unchangedFixtures = await Promise.all(
            result.originalFixtureBytes.map(async (fixture) => {
              const currentBytes = await fs.readFile(fixture.workspacePath)
              return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
            })
          )
          const deliveryText = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              result.fixtureDocs.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              structuralStarted.length >= 1 &&
              successfulWriteResults.length === 0 &&
              failedWriteResults.length === 1 &&
              watchHints.some(
                (event) => event.code === 'hand_docx_positioned_write_blocked'
              ) &&
              diagnosticMessages.some((message) => message.includes('当前命中复杂定位排版区域')) &&
              ((createSourcePaths.length === 0 && noSupplementArtifacts) ||
                (createdIndependentSupplement && independentSupplementArtifactsValid)) &&
              /(手动|版式|排版|没法自动|无法自动|复杂定位)/.test(deliveryText) &&
              unchangedFixtures.every(Boolean) &&
              typeof result.output?.deliveryMarkdown === 'string' &&
              result.output.deliveryMarkdown.trim().length > 0,
            {
              name: 'human-live-positioned-docx-stays-read-only-and-falls-back-cleanly',
              message:
                'live human positioned case 应拒绝对复杂定位区域的自动编辑，并在最终答复中明确回退处理；可只给手动补充建议，也可改为生成独立补充稿。',
              data: {
                openedSourcePaths,
                createSourcePaths,
                writeAttempts: structuralStarted.map((event) => ({
                  toolName: event.toolName,
                  action: event.input.action,
                  sourcePath: event.input.sourcePath
                })),
                failedWriteResults: failedWriteResults.map((event) => ({
                  toolName: event.toolName,
                  diagnostic: event.result?.diagnostic?.message
                })),
                watchHints,
                draftReviewArtifactCount,
                draftFileArtifactCount,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  }, 600_000)
})
