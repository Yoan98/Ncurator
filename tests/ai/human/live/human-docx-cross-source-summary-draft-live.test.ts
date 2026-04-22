import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS,
  HUMAN_DOCX_CROSS_SOURCE_SUMMARY_DRAFT_USER_INPUT,
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
        description: '验证 live 模式下 human 会读取两份已选源资料，并把总结内容回写到一份总结稿 docx 上。',
        fixtures: DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS,
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
          const fixtureDocs = resolveSelectedDocxFixtures(runtime, DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS)
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
              DOCX_CROSS_SOURCE_SUMMARY_FIXTURE_PATHS
            )
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_DOCX_CROSS_SOURCE_SUMMARY_DRAFT_USER_INPUT
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
          const unchangedFixtures = await Promise.all(
            result.originalFixtureBytes.map(async (fixture) => {
              const currentBytes = await fs.readFile(fixture.workspacePath)
              return Buffer.compare(currentBytes, Buffer.from(fixture.bytes)) === 0
            })
          )
          const sourceFixtures = result.fixtureDocs.filter((fixture) => fixture.name !== 'sample-edit.docx')
          const targetFixture = result.fixtureDocs.find((fixture) => fixture.name === 'sample-edit.docx')
          const deliveryText = `${result.output?.summary || ''}\n${result.output?.deliveryMarkdown || ''}`

          runtime.assertThat(
            result.output?.status === 'completed' &&
              sourceFixtures.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              Boolean(targetFixture) &&
              toolNames.some((toolName) => toolName.endsWith('_edit')) &&
              writeSourcePaths.length > 0 &&
              writeSourcePaths.every(
                (sourcePath) =>
                  sourcePath.endsWith(targetFixture!.relativePath) ||
                  sourcePath.endsWith(`/${targetFixture!.name}`)
              ) &&
              changedContentKinds.includes('paragraph') &&
              filterAiRunEventsByType(events, 'draft_review_ready').length >= 1 &&
              hasFileReviewArtifact(result.output?.artifacts) &&
              hasDraftFileArtifact(result.output?.artifacts) &&
              unchangedFixtures.every(Boolean) &&
              /(过拟合|过度拟合)/.test(deliveryText) &&
              /反走样/.test(deliveryText),
            {
              name: 'human-live-cross-source-summary-writes-only-target-draft-doc',
              message:
                'live human cross-source summary case 应读取两份源资料，并只把总结内容落到 sample-edit 草稿上。',
              data: {
                openedSourcePaths,
                writeSourcePaths,
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
