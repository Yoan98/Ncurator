import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_POSITIONED_FIXTURE_PATHS,
  DOCX_POSITIONED_SAFE_EDIT_FIXTURE_PATH,
  HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH,
  resolveSelectedDocxFixtures
} from '../../../../harness/backend/aiLiveTestData'
import {
  countDocxApplyArtifacts,
  countDocxFileArtifacts,
  collectToolErrorMessages,
  filterAiRunEventsByType,
  isDocxWriteInput,
  runWithStructuredOutputRetry
} from '../testUtils'

const fixturePaths = [...DOCX_POSITIONED_FIXTURE_PATHS, DOCX_POSITIONED_SAFE_EDIT_FIXTURE_PATH]

const fileHash = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

const openedExpectedDoc = (
  openedSourcePaths: readonly string[],
  expectedRelativePath: string,
  expectedName: string
): boolean =>
  openedSourcePaths.some((sourcePath) => {
    const normalizedSourcePath = sourcePath.replace(/\\/g, '/')
    return (
      normalizedSourcePath.endsWith(expectedRelativePath) ||
      normalizedSourcePath.endsWith(`/${expectedName}`)
    )
  })

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
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          if (!loadLiveLlmConfigFromEnv()) {
            return {
              configurationMissing: true,
              output: null,
              fixtureDocs: [],
              positionedSourceUnchanged: false,
              events: []
            }
          }

          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const fixtureDocs = resolveSelectedDocxFixtures(runtime, fixturePaths)
          const positionedFixtureDocs = fixtureDocs.filter((fixtureDoc) =>
            DOCX_POSITIONED_FIXTURE_PATHS.some(
              (fixturePath) => fixtureDoc.sourcePath === fixturePath
            )
          )
          const positionedHashesBefore = await Promise.all(
            positionedFixtureDocs.map(
              async (fixtureDoc) => await fileHash(fixtureDoc.workspacePath)
            )
          )
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxFixtureReferences(runtime, fixturePaths)
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT
          })

          return {
            configurationMissing: false,
            output,
            fixtureDocs,
            positionedSourceUnchanged: (
              await Promise.all(
                positionedFixtureDocs.map(
                  async (fixtureDoc, index) =>
                    (await fileHash(fixtureDoc.workspacePath)) === positionedHashesBefore[index]
                )
              )
            ).every(Boolean),
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.configurationMissing) {
            runtime.assertThat(false, {
              name: 'live-config-not-provided',
              message:
                '未提供 live 模型配置，已跳过 human live positioned structural edit fallback case。'
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
              ['docx_content_edit', 'docx_format', 'docx_table_edit'].includes(event.toolName) &&
              isDocxWriteInput(event.input) &&
              typeof event.input.sourcePath === 'string'
          )
          const positionedWriteToolCallIds = new Set(
            structuralStarted
              .filter((event) =>
                DOCX_POSITIONED_FIXTURE_PATHS.some((fixturePath) =>
                  openedExpectedDoc(
                    [String(event.input.sourcePath || '')],
                    fixturePath.replace(`${SHARED_WORKSPACE_FIXTURE_PATH}/`, ''),
                    '图形学.docx'
                  )
                )
              )
              .map((event) => event.toolCallId)
          )
          const safeWriteToolCallIds = new Set(
            structuralStarted
              .filter((event) =>
                openedExpectedDoc(
                  [String(event.input.sourcePath || '')],
                  'sample-edit.docx',
                  'sample-edit.docx'
                )
              )
              .map((event) => event.toolCallId)
          )
          const writeResults = filterAiRunEventsByType(events, 'tool_call_result').filter((event) =>
            structuralStarted.some((started) => started.toolCallId === event.toolCallId)
          )
          const successfulWriteResults = writeResults.filter((event) => event.result?.ok === true)
          const failedWriteResults = writeResults.filter((event) => event.result?.ok === false)
          const positionedWriteResults = writeResults.filter((event) =>
            positionedWriteToolCallIds.has(event.toolCallId)
          )
          const safeWriteResults = writeResults.filter((event) =>
            safeWriteToolCallIds.has(event.toolCallId)
          )
          const positionedFailedWriteResults = positionedWriteResults.filter(
            (event) =>
              event.result?.ok === false &&
              String(
                event.result?.data &&
                  typeof event.result.data === 'object' &&
                  !Array.isArray(event.result.data)
                  ? event.result.data.error
                  : ''
              ).includes('当前命中复杂定位排版区域')
          )
          const errorMessages = collectToolErrorMessages(events)
          const safeEditCompleted =
            safeWriteResults.some((event) => event.result?.ok === true) &&
            countDocxApplyArtifacts(result.output?.artifacts) >= 1 &&
            countDocxFileArtifacts(result.output?.artifacts) >= 1
          runtime.assertThat(
            result.output?.status === 'completed' &&
              result.fixtureDocs.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              positionedWriteResults.some((event) => event.result?.ok === false) &&
              positionedFailedWriteResults.length >= 1 &&
              positionedWriteResults.every((event) => event.result?.ok !== true) &&
              result.positionedSourceUnchanged &&
              errorMessages.some((message) => message.includes('当前命中复杂定位排版区域')) &&
              safeEditCompleted,
            {
              name: 'human-live-positioned-docx-skips-protected-area-and-reports-manual-fallback',
              message:
                'live human positioned case 应保护复杂定位区域、继续完成其他安全编辑，并在最终答复中说明该区域需手动处理。',
              data: {
                openedSourcePaths,
                writeAttempts: structuralStarted.map((event) => ({
                  toolName: event.toolName,
                  actions: Array.isArray(event.input.actions)
                    ? event.input.actions.map((action) =>
                        action && typeof action === 'object' && !Array.isArray(action)
                          ? (action as { type?: string }).type
                          : undefined
                      )
                    : [],
                  sourcePath: event.input.sourcePath
                })),
                successfulWriteResultCount: successfulWriteResults.length,
                positionedSourceUnchanged: result.positionedSourceUnchanged,
                failedWriteResults: failedWriteResults.map((event) => ({
                  toolName: event.toolName,
                  error:
                    event.result?.data &&
                    typeof event.result.data === 'object' &&
                    !Array.isArray(event.result.data)
                      ? event.result.data.error
                      : undefined
                }))
              }
            }
          )
        }
      })
    })
  })
})
