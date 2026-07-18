import path from 'node:path'
import { describe, it } from 'vitest'
import {
  loadLiveLlmConfigFromEnv,
  hasLiveLlmConfigInEnv
} from '../../../../harness/backend/llmConfig'
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

const LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS = 12_000

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
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              workspaceSeed: null,
              events: [],
              llmIoRecords: []
            }
          }

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
            skipped: false,
            output,
            workspaceSeed,
            events: runtime.eventCollector.snapshot(),
            llmIoRecords: runtime.eventCollector.snapshotLlmIo()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.workspaceSeed) {
            runtime.assertThat(true, {
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
          const createSourcePaths = filterAiRunEventsByType(events, 'tool_call_started')
            .filter((event) => event.toolName === 'docx_edit' && isDocxEditCreateInput(event.input))
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')
          const createdRelativePaths = createSourcePaths.map((sourcePath) =>
            toWorkspaceRelativePath(runtime.workspaceRoot, sourcePath)
          )
          const llmIoRecords = result.llmIoRecords
          const compactionRecords = llmIoRecords.filter(
            (record) => record.caller === 'human.context_compaction'
          )
          const latestBrainRecord = [...llmIoRecords]
            .reverse()
            .find((record) => record.caller === 'human.brain')
          const deliveryText = String(result.output?.deliveryMarkdown || '').trim()
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
                record.user.includes('<user_goal>') &&
                record.user.includes('<task_progress>') &&
                record.user.includes('<history_rounds>')
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
            Boolean(latestBrainRecord?.user.includes('<conversation_history>')) &&
            Boolean(latestBrainRecord?.user.includes('<round_history>')) &&
            Boolean(latestBrainRecord?.user.includes('<task_progress>')) &&
            Boolean(latestBrainRecord?.user.includes('最新一轮决策如下')) &&
            Boolean(latestBrainRecord?.user.includes('<compactions>')) &&
            Boolean(latestBrainRecord?.user.includes('<rounds>')) &&
            !latestBrainRecord?.user.includes('<latest_round>') &&
            hasExactEntityText(latestBrainRecord?.user, expectedLastWeekDocAnchor) &&
            !hasInventedEntityText(latestBrainRecord?.user, inventedLastWeekDocName)
          const taskCompletionSatisfied =
            result.output?.status === 'completed' &&
            deliveryText.length > 0 &&
            !hasInventedEntityText(deliveryText, inventedLastWeekDocName) &&
            toolNames.includes('docx_edit')
          const artifactSatisfied =
            hasDocxFileArtifact(result.output?.artifacts) &&
            hasDocxApplyArtifact(result.output?.artifacts) &&
            createSourcePaths.length >= 1 &&
            createdRelativePaths.every(
              (sourcePath) =>
                sourcePath.startsWith('工作/') || sourcePath === path.basename(sourcePath)
            )
          const scoreParts = {
            lifecycle: lifecycleSatisfied ? 1 : 0,
            summaryFormat: summaryFormatSatisfied ? 2 : 0,
            summaryQuality: summaryQualitySatisfied ? 2 : 0,
            continuity: continuitySatisfied ? 1 : 0,
            taskCompletion: taskCompletionSatisfied ? 2 : 0,
            artifact: artifactSatisfied ? 2 : 0
          }
          const score = Object.values(scoreParts).reduce((total, value) => total + value, 0)

          runtime.assertThat(score > 8, {
            name: 'human-live-context-compaction-natural-trigger-completes-task',
            message:
              '真实风险周报长任务按 10 分制评估全部压缩结果、压缩后连续性和最终文件交付，得分必须严格超过 8 分；压缩次数不作为失败条件。',
            data: {
              score,
              scoreParts,
              startedEvents,
              completedEvents,
              budgetEvents,
              compactionSummaries,
              compactionPrompts: compactionRecords.map((record) => record.user),
              latestBrainPrompt: latestBrainRecord?.user,
              ratios,
              toolNames,
              artifacts: result.output?.artifacts,
              deliveryText
            }
          })
        }
      })
    })
  })
})
