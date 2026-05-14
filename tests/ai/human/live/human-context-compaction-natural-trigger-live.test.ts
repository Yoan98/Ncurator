import path from 'node:path'
import { describe, it } from 'vitest'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  HUMAN_RISK_REPORT_DRAFT_USER_INPUT,
  loadRiskReportWorkspaceSeed,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../harness/backend/aiLiveTestData'
import {
  filterAiRunEventsByType,
  hasDraftFileArtifact,
  hasFileReviewArtifact,
  runWithStructuredOutputRetry
} from '../testUtils'

const toWorkspaceRelativePath = (workspaceRoot: string, sourcePath: string): string => {
  const relativePath = path.isAbsolute(sourcePath)
    ? path.relative(workspaceRoot, sourcePath)
    : sourcePath
  return path.posix.normalize(relativePath.split(path.sep).join('/')).replace(/^\.\//, '')
}

const normalizeAssertionText = (text: string): string => text.replace(/\s+/g, '')

const hasOwnerSummarySemantics = (text: string, expectedOwnerSummary: string): boolean =>
  text.includes(expectedOwnerSummary) ||
  /(?:最终复核窗口|最终合规复核|复核窗口).*(?:合规负责人\s*)?Alice.*(?:牵头|协调|把控)/.test(text)

const hasNextStepSemantics = (text: string, expectedNextStep: string): boolean =>
  text.includes(expectedNextStep) ||
  /财务接口人\s*Bob.*补齐付款材料(?:与附件映射说明)?，?并在复核前完成附件对齐/.test(
    text
  ) ||
  /Bob.*(?:负责|本周内)?.*补齐(?:剩余)?付款材料/.test(text)

const hasRiskConclusionSemantics = (
  text: string,
  expectedRiskConclusion: string
): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const normalizedExpected = normalizeAssertionText(expectedRiskConclusion)
  return (
    normalizedText.includes(normalizedExpected) ||
    /最终合规签署完成前[^。]{0,40}(?:仍需|继续)(?:保持|持续)跟进/.test(normalizedText) ||
    /风险仍需保持跟进/.test(normalizedText)
  )
}

describe('ai human live backend', () => {
  it('human-context-compaction-natural-trigger-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-compaction-natural-trigger-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下 human 在真实风险周报长任务中会自然触发 context compaction，并在压缩后继续完成任务。',
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              workspaceSeed: null,
              indexedFiles: [],
              events: [],
              llmIoRecords: []
            }
          }

          const workspaceSeed = await loadRiskReportWorkspaceSeed(runtime)
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const indexedFiles = await runtime.seedWorkspaceKb({
            mode: 'all-supported'
          })
          const runner = createHumanTestRunner(runtime, {
            humanRuntimeOverrides: {
              modelContextWindowTokens: 15_000
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: HUMAN_RISK_REPORT_DRAFT_USER_INPUT
          })

          return {
            skipped: false,
            output,
            workspaceSeed,
            indexedFiles,
            events: runtime.eventCollector.snapshot(),
            llmIoRecords: runtime.eventCollector.snapshotLlmIo()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.workspaceSeed) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human context compaction natural trigger live case。'
            })
            return
          }

          const events = result.events
          const startedEvents = filterAiRunEventsByType(events, 'context_compaction_started')
          const completedEvents = filterAiRunEventsByType(events, 'context_compaction_completed')
          const budgetEvents = filterAiRunEventsByType(events, 'context_budget_evaluated')
          const toolNames = filterAiRunEventsByType(events, 'tool_call_result').map((event) => event.toolName)
          const createSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName === 'docx_create')
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const createdRelativePaths = createSourcePaths.map((sourcePath) =>
            toWorkspaceRelativePath(runtime.workspaceRoot, sourcePath)
          )
          const llmIoRecords = result.llmIoRecords
          const compactionRecord = llmIoRecords.find((record) => record.caller === 'human.context_compaction')
          const latestBrainRecord = [...llmIoRecords]
            .reverse()
            .find((record) => record.caller === 'human.brain')
          const completionEvent = completedEvents[0]
          const deliveryText = String(result.output?.deliveryMarkdown || '').trim()
          const draftFileArtifact = result.output?.artifacts?.find(
            (artifact) =>
              artifact.kind === 'file' &&
              artifact.capability === 'docx' &&
              artifact.artifactRole === 'draft'
          )
          let reviewXml = ''
          const draftArtifactPath =
            draftFileArtifact?.kind === 'file' ? draftFileArtifact.path : undefined
          if (draftArtifactPath) {
            const reviewBundle = await loadDocxBundle(await import('node:fs/promises').then((fs) => fs.readFile(draftArtifactPath)))
            reviewXml = new XMLSerializer().serializeToString(reviewBundle.documentDom)
          }
          const generatedDraftText = `${reviewXml}\n${deliveryText}`
          const ratio =
            completionEvent && completionEvent.sourceHistoryTokenEstimate > 0
              ? completionEvent.tokenEstimateAfter / completionEvent.sourceHistoryTokenEstimate
              : Number.POSITIVE_INFINITY

          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedEvents.length >= 1 &&
              completedEvents.length >= 1 &&
              budgetEvents.some((event) => event.decision === 'compact') &&
              Boolean(compactionRecord?.rawText?.trim()) &&
              Boolean(latestBrainRecord?.user.includes('<compactions>')) &&
              Boolean(completionEvent?.summaryPreview.trim()) &&
              ratio <= 0.5 &&
              toolNames.includes('docx_create') &&
              hasDraftFileArtifact(result.output?.artifacts) &&
              hasFileReviewArtifact(result.output?.artifacts) &&
              createSourcePaths.length >= 1 &&
              createdRelativePaths.every(
                (sourcePath) => sourcePath.startsWith('工作/') || sourcePath === path.basename(sourcePath)
              ) &&
              hasOwnerSummarySemantics(generatedDraftText, result.workspaceSeed.expectedOwnerSummary) &&
              hasRiskConclusionSemantics(generatedDraftText, result.workspaceSeed.expectedRiskConclusion) &&
              hasNextStepSemantics(generatedDraftText, result.workspaceSeed.expectedNextStep),
            {
              name: 'human-live-context-compaction-natural-trigger-completes-task',
              message:
                '真实风险周报长任务应自然触发 context compaction，并在压缩后继续完成周报待确认稿交付。',
              data: {
                startedEvents,
                completedEvents,
                budgetEvents,
                compactionSummary: completionEvent?.summaryPreview,
                compactionPrompt: compactionRecord?.user,
                latestBrainPrompt: latestBrainRecord?.user,
                ratio,
                toolNames,
                artifacts: result.output?.artifacts,
                deliveryText
              }
            }
          )
        }
      })
    })
  }, 900_000)
})
