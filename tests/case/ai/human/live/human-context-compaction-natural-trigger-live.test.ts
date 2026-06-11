import path from 'node:path'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH,
  HUMAN_CONTEXT_COMPACTION_USER_INPUT,
  loadContextCompactionWorkspaceSeed
} from '../../../../harness/backend/liveScenarios/contextCompactionScenario'
import {
  filterAiRunEventsByType,
  hasDocxApplyArtifact,
  hasDocxFileArtifact,
  isDocxEditCreateInput,
  runWithStructuredOutputRetry
} from '../testUtils'

const toWorkspaceRelativePath = (workspaceRoot: string, sourcePath: string): string => {
  const relativePath = path.isAbsolute(sourcePath)
    ? path.relative(workspaceRoot, sourcePath)
    : sourcePath
  return path.posix.normalize(relativePath.split(path.sep).join('/')).replace(/^\.\//, '')
}

const LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS = 15_000

const hasExactEntityText = (text: string | undefined, entityText: string): boolean =>
  typeof text === 'string' && text.includes(entityText)

const hasInventedEntityText = (text: string | undefined, inventedEntityText: string): boolean =>
  typeof text === 'string' && text.includes(inventedEntityText)

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
              modelContextWindowTokens: LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS
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
            .filter((event) => event.toolName === 'docx_edit' && isDocxEditCreateInput(event.input))
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
          const ratio =
            completionEvent && completionEvent.sourceHistoryTokenEstimate > 0
              ? completionEvent.tokenEstimateAfter / completionEvent.sourceHistoryTokenEstimate
              : Number.POSITIVE_INFINITY
          const expectedLastWeekDocAnchor = '上周周报'
          const inventedLastWeekDocName = '上周工作周报.docx'

          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedEvents.length >= 1 &&
              startedEvents.length <= 2 &&
              completedEvents.length === startedEvents.length &&
              budgetEvents.some(
                (event) =>
                  event.decision === 'compact' &&
                  event.snapshot.basis === 'usage_plus_delta' &&
                  event.snapshot.budgetTokens > event.snapshot.compactionTriggerTokens
              ) &&
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
              hasExactEntityText(compactionRecord?.rawText, expectedLastWeekDocAnchor) &&
              !hasInventedEntityText(compactionRecord?.rawText, inventedLastWeekDocName) &&
              hasExactEntityText(latestBrainRecord?.user, expectedLastWeekDocAnchor) &&
              !hasInventedEntityText(latestBrainRecord?.user, inventedLastWeekDocName) &&
              !hasInventedEntityText(deliveryText, inventedLastWeekDocName) &&
              toolNames.includes('docx_edit') &&
              hasDocxFileArtifact(result.output?.artifacts) &&
              hasDocxApplyArtifact(result.output?.artifacts) &&
              createSourcePaths.length >= 1 &&
              createdRelativePaths.every(
                (sourcePath) => sourcePath.startsWith('工作/') || sourcePath === path.basename(sourcePath)
              ),
            {
              name: 'human-live-context-compaction-natural-trigger-completes-task',
              message:
                '真实风险周报长任务应自然触发 context compaction，并在压缩后继续完成周报文件交付。',
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
  })
})
