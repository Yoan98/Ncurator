import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
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
  isDocxContentCreateInput,
  runWithStructuredOutputRetry
} from '../testUtils'

const LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS = 24_000

const REQUIRED_COMPACTION_HEADINGS = [
  '任务锚点：',
  '已确认事实：',
  '仍有效约束：',
  '已尝试但未解决：',
  '重复或低价值内容：',
  '已失效或仅作背景的信息：'
] as const

const LOW_QUALITY_COMPACTION_PHRASES = [
  '结果与已有摘要一致',
  '已经读过了',
  '这个问题基本看过了',
  '应该不用再看了'
] as const

const hasContradictoryProgress = (text: string): boolean =>
  /(?:已读取所有|信息已收集完毕|具备生成条件)[^。\n]{0,80}(?:尚未读取|未读内容|仍需读取)/.test(
    text.replace(/\s+/g, '')
  )

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
        execute: async (runtime) => {
          const workspaceSeed = await loadContextCompactionWorkspaceSeed(runtime)
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
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
            output,
            workspaceSeed,
            events: runtime.eventCollector.snapshot(),
            llmIoRecords: runtime.eventCollector.snapshotLlmIo()
          }
        },
        assert: async (result, runtime) => {
          if (!result.workspaceSeed) {
            runtime.assertThat(false, {
              name: 'live-config-not-provided',
              message:
                '未提供 live 模型配置，已跳过 human context compaction natural trigger live case。'
            })
            return
          }

          const events = result.events
          const startedEvents = filterAiRunEventsByType(events, 'context_compaction_started')
          const completedEvents = filterAiRunEventsByType(events, 'context_compaction_completed')
          const budgetEvents = filterAiRunEventsByType(events, 'context_budget_evaluated')
          const toolNames = filterAiRunEventsByType(events, 'tool_call_result').map(
            (event) => event.toolName
          )
          const successfulToolCallIds = new Set(
            filterAiRunEventsByType(events, 'tool_call_result')
              .filter((event) => event.result?.ok === true)
              .map((event) => event.toolCallId)
          )
          const createSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter(
              (event) =>
                event.toolName === 'docx_content_edit' &&
                successfulToolCallIds.has(event.toolCallId) &&
                isDocxContentCreateInput(event.input)
            )
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const textCreateSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter(
              (event) =>
                event.toolName === 'text_file_edit' &&
                successfulToolCallIds.has(event.toolCallId) &&
                event.input.action === 'create'
            )
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const llmIoRecords = result.llmIoRecords
          const compactionRecords = llmIoRecords.filter(
            (record) => record.caller === 'human.context_compaction'
          )
          const latestBrainRecord = [...llmIoRecords]
            .reverse()
            .find((record) => record.caller === 'human.brain')
          const ratios = completedEvents.map((event) =>
            event.sourceHistoryTokenEstimate > 0
              ? event.tokenEstimateAfter / event.sourceHistoryTokenEstimate
              : Number.POSITIVE_INFINITY
          )
          const expectedLastWeekDocAnchor = '上周周报'
          const inventedLastWeekDocName = '上周工作周报.docx'
          const compactionSummaries = compactionRecords.map((record) =>
            String(record.rawText || '').trim()
          )
          const lifecycleSatisfied =
            startedEvents.length >= 1 &&
            completedEvents.length === startedEvents.length &&
            compactionRecords.length === completedEvents.length &&
            budgetEvents.some(
              (event) =>
                event.decision === 'compact' &&
                event.snapshot.basis === 'usage_plus_delta' &&
                event.snapshot.budgetTokens > event.snapshot.compactionTriggerTokens
            )
          const summaryFormatSatisfied =
            compactionSummaries.length > 0 &&
            compactionSummaries.every((summary) =>
              REQUIRED_COMPACTION_HEADINGS.every((heading) => summary.includes(heading))
            ) &&
            compactionRecords.every(
              (record) =>
                record.user.includes('<user_goal>') && record.user.includes('<history_text>')
            )
          const summaryQualitySatisfied =
            compactionSummaries.every(
              (summary) =>
                hasExactEntityText(summary, expectedLastWeekDocAnchor) &&
                !hasInventedEntityText(summary, inventedLastWeekDocName) &&
                !LOW_QUALITY_COMPACTION_PHRASES.some((phrase) => summary.includes(phrase)) &&
                !hasContradictoryProgress(summary)
            ) && ratios.every((ratio) => ratio <= 0.5)
          const continuitySatisfied =
            Boolean(latestBrainRecord?.user.includes('<current_state>')) &&
            Boolean(latestBrainRecord?.user.includes('<compacted_history>')) &&
            Boolean(latestBrainRecord?.user.includes('<learned_skills>')) &&
            hasExactEntityText(latestBrainRecord?.user, expectedLastWeekDocAnchor) &&
            !hasInventedEntityText(latestBrainRecord?.user, inventedLastWeekDocName)
          const taskCompletionSatisfied =
            result.output?.status === 'completed' &&
            (toolNames.some((toolName) => toolName.startsWith('docx_')) ||
              toolNames.includes('text_file_edit'))
          const artifactSatisfied =
            (hasDocxFileArtifact(result.output?.artifacts) &&
              hasDocxApplyArtifact(result.output?.artifacts) &&
              createSourcePaths.length >= 1) ||
            textCreateSourcePaths.length >= 1
          runtime.assertThat(
            lifecycleSatisfied &&
              summaryFormatSatisfied &&
              summaryQualitySatisfied &&
              continuitySatisfied &&
              taskCompletionSatisfied &&
              artifactSatisfied,
            {
              name: 'human-live-context-compaction-natural-trigger-completes-task',
              message:
                '真实风险周报长任务应自然触发上下文压缩，压缩后保持连续性并完成周报文件交付；压缩次数不作为失败条件。',
              data: {
                startedEvents,
                completedEvents,
                budgetEvents,
                compactionSummaries,
                compactionPrompts: compactionRecords.map((record) => record.user),
                latestBrainPrompt: latestBrainRecord?.user,
                ratios,
                toolNames,
                createSourcePaths,
                textCreateSourcePaths,
                artifacts: result.output?.artifacts
              }
            }
          )
        }
      })
    })
  }, 1_800_000)
})
