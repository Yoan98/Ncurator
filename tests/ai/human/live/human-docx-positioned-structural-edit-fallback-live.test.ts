import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_READING_FIXTURE_PATHS,
  HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT,
  resolveSelectedDocxFixtures
} from '../../../harness/backend/aiLiveTestData'
import {
  collectToolDiagnosticMessages,
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

describe('ai human live backend', () => {
  it('human-docx-positioned-structural-edit-fallback-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-positioned-structural-edit-fallback-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 在复杂 positioned docx 中只执行安全修改，并对结构性写入做优雅回退。',
        fixtures: DOCX_READING_FIXTURE_PATHS,
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
              originalFixtureBytes: [],
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv('primary'))
          const fixtureDocs = resolveSelectedDocxFixtures(runtime, DOCX_READING_FIXTURE_PATHS)
          const originalFixtureBytes = await Promise.all(
            fixtureDocs.map(async (fixtureDoc) => ({
              name: fixtureDoc.name,
              relativePath: fixtureDoc.relativePath,
              workspacePath: fixtureDoc.workspacePath,
              bytes: await fs.readFile(fixtureDoc.workspacePath)
            }))
          )
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxFixtureReferences(runtime, DOCX_READING_FIXTURE_PATHS)
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
                event.toolName === 'docx_table_edit') &&
              (event.input.action === 'insert_before' || event.input.action === 'insert_after')
          )
          const writeResults = filterAiRunEventsByType(events, 'tool_call_result').filter((event) =>
            event.toolName.startsWith('docx_')
          )
          const successfulWriteResults = writeResults.filter(
            (event) =>
              (event.toolName === 'docx_text_edit' ||
                event.toolName === 'docx_text_style_edit' ||
                event.toolName === 'docx_paragraph_edit' ||
                event.toolName === 'docx_heading_edit') &&
              event.result?.ok === true
          )
          const failedStructuralResults = writeResults.filter(
            (event) =>
              (event.toolName === 'docx_paragraph_edit' ||
                event.toolName === 'docx_heading_edit' ||
                event.toolName === 'docx_table_edit') &&
              event.result?.ok === false
          )
          const diagnosticMessages = collectToolDiagnosticMessages(events)
          const unchangedFixtures = await Promise.all(
            result.originalFixtureBytes.map(async (fixture) => {
              const currentBytes = await fs.readFile(fixture.workspacePath)
              return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
            })
          )
          const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

          runtime.assertThat(
            result.output?.status === 'completed' &&
              result.fixtureDocs.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              successfulWriteResults.length >= 1 &&
              structuralStarted.length >= 1 &&
              failedStructuralResults.length >= 1 &&
              diagnosticMessages.some((message) => message.includes('当前命中复杂定位排版区域')) &&
              /(手动|版式|排版|没法自动|无法自动|自己补)/.test(deliveryText) &&
              unchangedFixtures.every(Boolean),
            {
              name: 'human-live-positioned-structural-edit-falls-back-cleanly',
              message:
                'live human positioned case 应保留安全修改，拦截结构性写入，并在最终答复中说明需要手动补充的部分。',
              data: {
                openedSourcePaths,
                structuralStarted: structuralStarted.map((event) => ({
                  toolName: event.toolName,
                  action: event.input.action,
                  sourcePath: event.input.sourcePath
                })),
                successfulWriteResults: successfulWriteResults.map((event) => event.toolName),
                failedStructuralResults: failedStructuralResults.map((event) => ({
                  toolName: event.toolName,
                  diagnostic: event.result?.diagnostic?.message
                })),
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
