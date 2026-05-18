import path from 'node:path'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH,
  HUMAN_CONTEXT_COMPACTION_USER_INPUT,
  loadContextCompactionWorkspaceSeed
} from '../../../harness/backend/liveScenarios/contextCompactionScenario'
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
  /(?:最终复核窗口|最终合规复核|复核窗口).*(?:合规负责人\s*)?Alice.*(?:牵头|协调|把控)/.test(
    text
  ) ||
  /(?:主负责人|负责人说明|外发主负责人).{0,20}Alice/.test(text) ||
  /Alice.{0,20}(?:统一对外收口|统一|主负责人)/.test(text)

const hasNextStepSemantics = (text: string, expectedNextStep: string): boolean =>
  text.includes(expectedNextStep) ||
  /财务接口人\s*Bob.*补齐付款材料(?:与附件映射说明)?，?并在复核前完成附件对齐/.test(
    text
  ) ||
  /Bob.*(?:负责|本周内)?.*补齐(?:剩余)?付款材料/.test(text) ||
  /后续安排[:：].*(?:跟进|确认|复核|补齐|完成)/.test(text) ||
  /继续跟进(?:供应商|最终合规附件|最终合规签署).*(?:确认|复核|状态)/.test(text)

const hasRiskConclusionSemantics = (
  text: string,
  expectedRiskConclusion: string
): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const normalizedExpected = normalizeAssertionText(expectedRiskConclusion)
  return (
    normalizedText.includes(normalizedExpected) ||
    /最终合规签署完成前[^。]{0,40}(?:仍需|继续)(?:保持|持续)跟进/.test(normalizedText) ||
    /风险仍需保持跟进/.test(normalizedText) ||
    /(?:最终合规签署尚未闭环|最终合规附件仍在内部确认中)[^。]{0,60}(?:持续跟进|保持跟进|仍需跟进)/.test(
      normalizedText
    ) ||
    /不建议[^。]{0,20}(?:风险已解除|全部完成)/.test(normalizedText)
  )
}

const hasExactEntityText = (text: string | undefined, entityText: string): boolean =>
  typeof text === 'string' && text.includes(entityText)

const hasInventedEntityText = (text: string | undefined, inventedEntityText: string): boolean =>
  typeof text === 'string' && text.includes(inventedEntityText)

type DocxOutlineBlock = {
  preview?: string
}

type DocxOutlineResult = {
  sourcePath?: string
  blocks?: DocxOutlineBlock[]
}

type DocxCreateResult = {
  sourcePath?: string
}

const readLatestCreatedSourcePath = (
  events: ReturnType<typeof filterAiRunEventsByType>
): string | undefined => {
  const latestCreateEvent = [...filterAiRunEventsByType(events, 'tool_call_result')]
    .reverse()
    .find((event) => event.toolName === 'docx_create' && event.result?.data)
  const createData = latestCreateEvent?.result?.data as DocxCreateResult | undefined
  return createData?.sourcePath
}

const extractDraftReadbackText = (
  events: ReturnType<typeof filterAiRunEventsByType>,
  createdSourcePath: string | undefined
): string => {
  if (!createdSourcePath) {
    return ''
  }

  const draftOutlineEvent = [...filterAiRunEventsByType(events, 'tool_call_result')]
    .reverse()
    .find((event) => {
      if (event.toolName !== 'docx_outline' || !event.result?.data) {
        return false
      }
      const outlineData = event.result.data as DocxOutlineResult
      return outlineData.sourcePath === createdSourcePath
    })

  const draftOutlineData = draftOutlineEvent?.result?.data as DocxOutlineResult | undefined
  return (draftOutlineData?.blocks || [])
    .map((block) => block.preview || '')
    .join('\n')
    .trim()
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
        fixtures: [CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH],
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

          const workspaceSeed = await loadContextCompactionWorkspaceSeed(runtime)
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
            userInput: HUMAN_CONTEXT_COMPACTION_USER_INPUT
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
          const createdSourcePath = readLatestCreatedSourcePath(events)
          const draftReadbackText = extractDraftReadbackText(events, createdSourcePath)
          const ratio =
            completionEvent && completionEvent.sourceHistoryTokenEstimate > 0
              ? completionEvent.tokenEstimateAfter / completionEvent.sourceHistoryTokenEstimate
              : Number.POSITIVE_INFINITY
          const expectedLastWeekDocName = path.basename(result.workspaceSeed.lastWeekReportRelativePath)
          const inventedLastWeekDocName = '上周工作周报.docx'

          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedEvents.length >= 1 &&
              completedEvents.length >= 1 &&
              budgetEvents.some((event) => event.decision === 'compact') &&
              Boolean(compactionRecord?.rawText?.trim()) &&
              Boolean(latestBrainRecord?.user.includes('<conversation_history>')) &&
              Boolean(latestBrainRecord?.user.includes('<round_history>')) &&
              Boolean(latestBrainRecord?.user.includes('<task_progress>')) &&
              Boolean(latestBrainRecord?.user.includes('最新一轮决策如下')) &&
              Boolean(latestBrainRecord?.user.includes('<compactions>')) &&
              Boolean(latestBrainRecord?.user.includes('<rounds>')) &&
              !Boolean(latestBrainRecord?.user.includes('<latest_round>')) &&
              Boolean(completionEvent?.summaryPreview.trim()) &&
              ratio <= 0.5 &&
              Boolean(compactionRecord?.user.includes('<user_goal>')) &&
              Boolean(compactionRecord?.user.includes('<task_progress>')) &&
              Boolean(compactionRecord?.user.includes('<history_rounds>')) &&
              Boolean(compactionRecord?.rawText.includes('任务锚点：')) &&
              Boolean(compactionRecord?.rawText.includes('已确认事实：')) &&
              Boolean(compactionRecord?.rawText.includes('仍有效约束：')) &&
              Boolean(compactionRecord?.rawText.includes('已尝试但未解决：')) &&
              Boolean(compactionRecord?.rawText.includes('重复或低价值内容：')) &&
              Boolean(compactionRecord?.rawText.includes('已失效或仅作背景的信息：')) &&
              !Boolean(compactionRecord?.rawText.includes('结果与已有摘要一致')) &&
              !Boolean(compactionRecord?.rawText.includes('已经读过了')) &&
              !Boolean(compactionRecord?.rawText.includes('这个问题基本看过了')) &&
              !Boolean(compactionRecord?.rawText.includes('应该不用再看了')) &&
              hasExactEntityText(compactionRecord?.rawText, expectedLastWeekDocName) &&
              !hasInventedEntityText(compactionRecord?.rawText, inventedLastWeekDocName) &&
              hasExactEntityText(latestBrainRecord?.user, expectedLastWeekDocName) &&
              !hasInventedEntityText(latestBrainRecord?.user, inventedLastWeekDocName) &&
              hasExactEntityText(deliveryText, expectedLastWeekDocName) &&
              !hasInventedEntityText(deliveryText, inventedLastWeekDocName) &&
              toolNames.includes('docx_create') &&
              hasDraftFileArtifact(result.output?.artifacts) &&
              hasFileReviewArtifact(result.output?.artifacts) &&
              createSourcePaths.length >= 1 &&
              createdRelativePaths.every(
                (sourcePath) => sourcePath.startsWith('工作/') || sourcePath === path.basename(sourcePath)
              ) &&
              Boolean(draftReadbackText) &&
              hasOwnerSummarySemantics(draftReadbackText, result.workspaceSeed.expectedOwnerSummary) &&
              hasRiskConclusionSemantics(
                draftReadbackText,
                result.workspaceSeed.expectedRiskConclusion
              ) &&
              hasNextStepSemantics(draftReadbackText, result.workspaceSeed.expectedNextStep),
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
                draftReadbackText,
                deliveryText
              }
            }
          )
        }
      })
    })
  }, 900_000)
})
