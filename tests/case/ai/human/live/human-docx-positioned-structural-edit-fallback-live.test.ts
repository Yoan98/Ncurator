import { describe, it } from 'vitest'
import {
  loadLiveLlmConfigFromEnv,
  hasLiveLlmConfigInEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_POSITIONED_FIXTURE_PATHS,
  HUMAN_DOCX_POSITIONED_STRUCTURAL_EDIT_FALLBACK_USER_INPUT,
  SHARED_WORKSPACE_FIXTURE_PATH,
  resolveSelectedDocxFixtures
} from '../../../../harness/backend/aiLiveTestData'
import {
  countDocxApplyArtifacts,
  countDocxFileArtifacts,
  collectToolErrorMessages,
  filterAiRunEventsByType,
  isDocxEditCreateInput,
  isDocxEditWriteInput,
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
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
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
          const fixtureDocs = resolveSelectedDocxFixtures(runtime, DOCX_POSITIONED_FIXTURE_PATHS)
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
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
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
              event.toolName === 'docx_edit' &&
              isDocxEditWriteInput(event.input) &&
              typeof event.input.sourcePath === 'string'
          )
          const writeResults = filterAiRunEventsByType(events, 'tool_call_result').filter((event) =>
            structuralStarted.some((started) => started.toolCallId === event.toolCallId)
          )
          const createSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName === 'docx_edit' && isDocxEditCreateInput(event.input))
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const successfulWriteResults = writeResults.filter((event) => event.result?.ok === true)
          const failedWriteResults = writeResults.filter((event) => event.result?.ok === false)
          const positionedFailedWriteResults = failedWriteResults.filter((event) =>
            String(
              event.result?.data &&
              typeof event.result.data === 'object' &&
              !Array.isArray(event.result.data)
                ? event.result.data.error
                : ''
            ).includes('当前命中复杂定位排版区域')
          )
          const decisionHints = filterAiRunEventsByType(events, 'decision_hint')
          const errorMessages = collectToolErrorMessages(events)
          const docxApplyArtifactCount = countDocxApplyArtifacts(result.output?.artifacts)
          const docxFileArtifactCount = countDocxFileArtifacts(result.output?.artifacts)
          const createdIndependentSupplement =
            createSourcePaths.length >= 1 &&
            createSourcePaths.every((sourcePath) =>
              sourcePath.endsWith(POSITIONED_FALLBACK_SUPPLEMENT_RELATIVE_PATH)
            )
          const artifactShapeValid =
            createSourcePaths.length === 0 ||
            (createdIndependentSupplement &&
              docxApplyArtifactCount >= 1 &&
              docxFileArtifactCount >= 1)
          const deliveryText = String(result.output?.deliveryMarkdown || '')
          const deliveryMentionsSkippedPositionedArea =
            /(复杂定位|定位排版|版式|排版)/.test(deliveryText) &&
            /(未.{0,12}自动|没有.{0,12}自动|没法自动|无法自动|不能自动|暂不支持.{0,4}自动|跳过)/.test(
              deliveryText
            ) &&
            /(手动|人工)/.test(deliveryText)
          const deliveryContainsUsableFallback =
            /(子像素|多重采样|MSAA|SSAA)/i.test(deliveryText) &&
            /(低通|频域|傅里叶)/.test(deliveryText) &&
            /(总结表|\|.{0,20}方法.{0,20}\|)/.test(deliveryText)
          const scoreParts = {
            targetDocumentOpened: result.fixtureDocs.every((fixtureDoc) =>
              openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
            )
              ? 1
              : 0,
            positionedProtectionTriggered:
              structuralStarted.length >= 1 &&
              positionedFailedWriteResults.length >= 1 &&
              decisionHints.some((event) => event.code === 'hand_docx_positioned_write_blocked') &&
              errorMessages.some((message) =>
                message.includes('当前命中复杂定位排版区域')
              )
                ? 2
                : 0,
            protectedAreaNotWritten: successfulWriteResults.length === 0 ? 1.5 : 0,
            manualFallbackExplained: deliveryMentionsSkippedPositionedArea ? 2 : 0,
            usableFallbackContent: deliveryContainsUsableFallback ? 2 : 0,
            artifactShapeConsistent: artifactShapeValid ? 1 : 0,
            nonEmptyDelivery: deliveryText.trim().length > 0 ? 0.5 : 0
          }
          const score = Object.values(scoreParts).reduce((total, value) => total + value, 0)

          runtime.assertThat(
            score > 8,
            {
              name: 'human-live-positioned-docx-skips-protected-area-and-reports-manual-fallback',
              message:
                'live human positioned case 完成度评分必须严格高于 8 分：应保护复杂定位区域，并给出可用的手动补充内容。',
              data: {
                score,
                scoreParts,
                openedSourcePaths,
                createSourcePaths,
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
                failedWriteResults: failedWriteResults.map((event) => ({
                  toolName: event.toolName,
                  error:
                    event.result?.data &&
                    typeof event.result.data === 'object' &&
                    !Array.isArray(event.result.data)
                      ? event.result.data.error
                      : undefined
                })),
                decisionHints,
                docxApplyArtifactCount,
                docxFileArtifactCount,
                deliveryMarkdown: result.output?.deliveryMarkdown
              }
            }
          )
        }
      })
    })
  })
})
