import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildSelectedDocxFixtureReferences,
  DOCX_CROSS_FILE_FIXTURE_PATHS,
  hasUnchangedFileBytes,
  HUMAN_DOCX_CONTEXTUAL_COMPARISON_DRAFT_USER_INPUT,
  resolveSelectedDocxFixtures
} from '../../../harness/backend/aiLiveTestData'
import {
  collectDocxApplyOpsContentKinds,
  collectStartedToolStringArgs,
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

const hasTargetReadBeforeApply = (events: readonly AiRunEvent[]): boolean => {
  const firstApplyIndex = events.findIndex(
    (event) => event.type === 'tool_call_started' && event.toolName === 'docx_apply_ops'
  )
  if (firstApplyIndex <= 0) {
    return false
  }

  return events.slice(0, firstApplyIndex).some((event) => {
    if (event.type !== 'tool_call_started') {
      return false
    }
    if (event.toolName === 'docx_search') {
      const query = event.input.query
      return typeof query === 'string' && query.includes('反走样')
    }
    return event.toolName === 'docx_outline' || event.toolName === 'docx_get_block'
  })
}

describe('ai human live backend', () => {
  it('human-docx-contextual-comparison-draft-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-docx-contextual-comparison-draft-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模式下 human 会在图形学相关位置后补写说明和对照表，并生成 confirm copy。',
        fixtures: DOCX_CROSS_FILE_FIXTURE_PATHS,
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
          const fixtureDocs = resolveSelectedDocxFixtures(runtime)
          const originalFixtureBytes = await Promise.all(
            fixtureDocs.map(async (fixtureDoc) => ({
              name: fixtureDoc.name,
              relativePath: fixtureDoc.relativePath,
              workspacePath: fixtureDoc.workspacePath,
              bytes: await fs.readFile(fixtureDoc.workspacePath)
            }))
          )
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: buildSelectedDocxFixtureReferences(runtime)
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_DOCX_CONTEXTUAL_COMPARISON_DRAFT_USER_INPUT
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
              message: '未提供 live 模型配置，已跳过 human live contextual docx comparison draft case。'
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
          const unchangedFixtures = await Promise.all(
            result.originalFixtureBytes.map(async (fixture) =>
              await hasUnchangedFileBytes(fixture.workspacePath, fixture.bytes)
            )
          )

          runtime.assertThat(
            result.output?.status === 'completed' &&
              result.fixtureDocs.every((fixtureDoc) =>
                openedExpectedDoc(openedSourcePaths, fixtureDoc.relativePath, fixtureDoc.name)
              ) &&
              hasTargetReadBeforeApply(events) &&
              toolNames.includes('docx_apply_ops') &&
              docxArtifacts.length > 0 &&
              hasDraftReviewArtifact &&
              changedContentKinds.includes('paragraph') &&
              changedContentKinds.includes('table') &&
              unchangedFixtures.every(Boolean),
            {
              name: 'human-live-contextual-docx-write-produces-confirm-copy-without-overwriting-source',
              message: 'live human 定位补写 case 应在读取定位后补写说明和表格，并仅生成 confirm copy。',
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
