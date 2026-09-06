import { describe, it } from 'vitest'
import type { AiLlmIoRecord, AiRunEvent } from '../../../../../src/shared/types'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH,
  HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT,
  HUMAN_CONTEXT_COMPACTION_USER_INPUT,
  loadContextCompactionWorkspaceSeed
} from '../../../../harness/backend/liveScenarios/contextCompactionScenario'
import {
  collectSuccessfulDocxWriteSourcePaths,
  filterAiRunEventsByType,
  hasDocxDeliveryEvidence,
  isDocxContentCreateInput,
  runWithStructuredOutputRetry
} from '../testUtils'

const PARTNER_ID = 'live-context-compaction'
const LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS = 45_000

const REQUIRED_COMPACTION_HEADINGS = [
  '当前交付：',
  '已确认事实：',
  '已尝试但未解决：',
  '历史事实：'
] as const

const expectedLastWeekDocAnchor = '上周周报'
const inventedLastWeekDocName = '上周工作周报.docx'

const extractSection = (summary: string, heading: string): string => {
  const start = summary.indexOf(heading)
  if (start < 0) return ''
  const rest = summary.slice(start + heading.length)
  let end = rest.length
  for (const other of REQUIRED_COMPACTION_HEADINGS) {
    if (other === heading) continue
    const index = rest.indexOf(other)
    if (index >= 0 && index < end) end = index
  }
  return rest.slice(0, end).trim()
}

const isEmptyHistorySection = (section: string): boolean => {
  const normalized = section.replace(/\s+/g, '')
  return normalized === '' || normalized === '-无' || normalized === '无'
}

const hasTimelineMarker = (section: string): boolean =>
  /\d{4}[-/年.]|\d{1,2}[:：]\d{2}|current_time|周|月|日/.test(section)

const parseBrainMessageRoles = (user: string): string[] => {
  try {
    const parsed = JSON.parse(user) as Array<{ role?: string }>
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item.role || ''))
  } catch {
    return []
  }
}

const isCompactedBrainShape = (record: AiLlmIoRecord): boolean => {
  const roles = parseBrainMessageRoles(record.user)
  return (
    roles.length === 2 &&
    roles[0] === 'system' &&
    roles[1] === 'human' &&
    record.user.includes('<memory>')
  )
}

const firstBrainAfterCompaction = (
  records: readonly AiLlmIoRecord[]
): AiLlmIoRecord | undefined => {
  let seenCompaction = false
  for (const record of records) {
    if (record.caller === 'human.context_compaction') {
      seenCompaction = true
      continue
    }
    if (seenCompaction && record.caller === 'human.brain') return record
  }
  return undefined
}

const collectRunCompaction = (input: {
  events: readonly AiRunEvent[]
  llmIoRecords: readonly AiLlmIoRecord[]
}) => {
  const startedEvents = filterAiRunEventsByType(input.events, 'context_compaction_started')
  const completedEvents = filterAiRunEventsByType(input.events, 'context_compaction_completed')
  const budgetEvents = filterAiRunEventsByType(input.events, 'context_budget_evaluated')
  const compactionRecords = input.llmIoRecords.filter(
    (record) => record.caller === 'human.context_compaction'
  )
  const summaries = compactionRecords.map((record) => String(record.rawText || '').trim())
  return {
    startedEvents,
    completedEvents,
    budgetEvents,
    compactionRecords,
    summaries,
    lifecycleSatisfied:
      startedEvents.length >= 1 &&
      completedEvents.length === startedEvents.length &&
      compactionRecords.length === completedEvents.length &&
      budgetEvents.some(
        (event) =>
          event.decision === 'compact' &&
          event.snapshot.basis === 'usage_plus_delta' &&
          event.snapshot.budgetTokens > event.snapshot.compactionTriggerTokens
      )
  }
}

const collectDocxEvidence = (input: {
  events: readonly AiRunEvent[]
  artifacts: readonly { kind?: string; capability?: string; applyId?: string }[] | undefined
}) => {
  const successfulToolCallIds = new Set(
    filterAiRunEventsByType(input.events, 'tool_call_result')
      .filter((event) => event.result?.ok === true)
      .map((event) => event.toolCallId)
  )
  const createSourcePaths = filterAiRunEventsByType(input.events, 'tool_call_started')
    .filter(
      (event) =>
        event.toolName === 'docx_content_edit' &&
        successfulToolCallIds.has(event.toolCallId) &&
        isDocxContentCreateInput(event.input)
    )
    .map((event) => event.input.sourcePath)
    .filter((value): value is string => typeof value === 'string')
  const docxWriteSourcePaths = collectSuccessfulDocxWriteSourcePaths(
    input.events,
    successfulToolCallIds
  )
  const textCreateSourcePaths = filterAiRunEventsByType(input.events, 'tool_call_started')
    .filter(
      (event) =>
        event.toolName === 'text_file_edit' &&
        successfulToolCallIds.has(event.toolCallId) &&
        event.input.action === 'create'
    )
    .map((event) => event.input.sourcePath)
    .filter((value): value is string => typeof value === 'string')
  const toolNames = filterAiRunEventsByType(input.events, 'tool_call_result').map(
    (event) => event.toolName
  )
  return {
    toolNames,
    createSourcePaths,
    docxWriteSourcePaths,
    textCreateSourcePaths,
    artifactSatisfied:
      hasDocxDeliveryEvidence({
        artifacts: input.artifacts,
        events: input.events
      }) &&
      (docxWriteSourcePaths.length >= 1 ||
        createSourcePaths.length >= 1 ||
        textCreateSourcePaths.length >= 1)
  }
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
          '验证 live 模式下 human 在真实风险周报长任务中会自然触发伙伴记忆压缩，压完后以 System + 带 <memory> 的当前 user 继续完成交付，并在同伙伴复杂续做中压出非空历史时间线。',
        fixtures: [CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const workspaceSeed = await loadContextCompactionWorkspaceSeed(runtime)
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const runnerOptions = {
            partnerId: PARTNER_ID,
            humanRuntimeOverrides: {
              modelContextWindowTokens: LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS
            }
          }
          const run1Output = await createHumanTestRunner(runtime, runnerOptions).run({
            taskId: `${runtime.taskId}-run-1`,
            userInput: HUMAN_CONTEXT_COMPACTION_USER_INPUT
          })
          const run1EventCount = runtime.eventCollector.snapshot().length
          const run1LlmCount = runtime.eventCollector.snapshotLlmIo().length
          const run2Output = await createHumanTestRunner(runtime, runnerOptions).run({
            taskId: `${runtime.taskId}-run-2`,
            userInput: HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT
          })
          const allEvents = runtime.eventCollector.snapshot()
          const allLlmIo = runtime.eventCollector.snapshotLlmIo()
          return {
            workspaceSeed,
            run1Output,
            run2Output,
            run1Events: allEvents.slice(0, run1EventCount),
            run2Events: allEvents.slice(run1EventCount),
            run1LlmIo: allLlmIo.slice(0, run1LlmCount),
            run2LlmIo: allLlmIo.slice(run1LlmCount)
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

          const run1Compaction = collectRunCompaction({
            events: result.run1Events,
            llmIoRecords: result.run1LlmIo
          })
          const run2Compaction = collectRunCompaction({
            events: result.run2Events,
            llmIoRecords: result.run2LlmIo
          })
          const run1Docx = collectDocxEvidence({
            events: result.run1Events,
            artifacts: result.run1Output?.artifacts
          })
          const run1PostCompactBrain = firstBrainAfterCompaction(result.run1LlmIo)
          const run1LatestBrain = [...result.run1LlmIo]
            .reverse()
            .find((record) => record.caller === 'human.brain')
          const run1SummaryFormatSatisfied =
            run1Compaction.summaries.length > 0 &&
            run1Compaction.summaries.every((summary) =>
              REQUIRED_COMPACTION_HEADINGS.every((heading) => summary.includes(heading))
            ) &&
            run1Compaction.compactionRecords.every(
              (record) => record.user.includes('<current>') && record.user.includes('<earlier>')
            )
          const run1SummaryQualitySatisfied = run1Compaction.summaries.every(
            (summary) =>
              summary.includes(expectedLastWeekDocAnchor) &&
              !summary.includes(inventedLastWeekDocName)
          )
          const run1CompactedBrainSatisfied = Boolean(
            run1PostCompactBrain && isCompactedBrainShape(run1PostCompactBrain)
          )
          const run1ContinuitySatisfied =
            Boolean(run1LatestBrain?.user.includes(expectedLastWeekDocAnchor)) &&
            Boolean(run1LatestBrain && !run1LatestBrain.user.includes(inventedLastWeekDocName)) &&
            Boolean(run1LatestBrain?.user.includes('<memory>'))
          const run1TaskCompletionSatisfied =
            result.run1Output?.status === 'completed' &&
            (run1Docx.toolNames.some((toolName) => toolName.startsWith('docx_')) ||
              run1Docx.toolNames.includes('text_file_edit'))

          const latestRun2Summary = run2Compaction.summaries.at(-1) || ''
          const run2FirstBrain = result.run2LlmIo.find((record) => record.caller === 'human.brain')
          const run2FirstBrainRoles = run2FirstBrain
            ? parseBrainMessageRoles(run2FirstBrain.user)
            : []
          const run2FirstBrainSatisfied =
            Boolean(run2FirstBrain?.user.includes('<memory>')) &&
            run2FirstBrainRoles[0] === 'system' &&
            run2FirstBrainRoles[1] === 'human' &&
            run2FirstBrainRoles.at(-1) === 'human' &&
            Boolean(run2FirstBrain?.user.includes(HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT)) &&
            run2FirstBrainRoles[1] !== 'ai' &&
            run2FirstBrainRoles[1] !== 'tool'
          const run2HistorySection = extractSection(latestRun2Summary, '历史事实：')
          const run2CurrentSection = [
            extractSection(latestRun2Summary, '当前交付：'),
            extractSection(latestRun2Summary, '已尝试但未解决：')
          ].join('\n')
          const run2HistorySatisfied =
            run2Compaction.summaries.length > 0 &&
            REQUIRED_COMPACTION_HEADINGS.every((heading) => latestRun2Summary.includes(heading)) &&
            !isEmptyHistorySection(run2HistorySection) &&
            hasTimelineMarker(run2HistorySection) &&
            (run2HistorySection.includes(expectedLastWeekDocAnchor) ||
              /\.docx|周报/.test(run2HistorySection))
          const run2CurrentTaskSatisfied =
            /(对照|标题|九月|法务)/.test(run2CurrentSection) &&
            !/从空白模板整份|整份重填周报/.test(run2CurrentSection)

          runtime.assertThat(
            run1Compaction.lifecycleSatisfied &&
              run1SummaryFormatSatisfied &&
              run1SummaryQualitySatisfied &&
              run1CompactedBrainSatisfied &&
              run1ContinuitySatisfied &&
              run1TaskCompletionSatisfied &&
              run1Docx.artifactSatisfied,
            {
              name: 'human-live-context-compaction-run1-completes-weekly-report',
              message:
                'Run 1 应至少压缩一次；压完后发给 brain 的数组为 system + 带 <memory> 的当前 user，四段标题齐全，含「上周周报」、不编造「上周工作周报.docx」，并成功交付周报。',
              data: {
                startedEvents: run1Compaction.startedEvents,
                completedEvents: run1Compaction.completedEvents,
                compactionSummaries: run1Compaction.summaries,
                compactionPrompts: run1Compaction.compactionRecords.map((record) => record.user),
                postCompactBrainRoles: run1PostCompactBrain
                  ? parseBrainMessageRoles(run1PostCompactBrain.user)
                  : [],
                latestBrainPrompt: run1LatestBrain?.user,
                toolNames: run1Docx.toolNames,
                createSourcePaths: run1Docx.createSourcePaths,
                docxWriteSourcePaths: run1Docx.docxWriteSourcePaths,
                artifacts: result.run1Output?.artifacts
              }
            }
          )

          runtime.assertThat(
            run2Compaction.lifecycleSatisfied &&
              run2FirstBrainSatisfied &&
              run2HistorySatisfied &&
              run2CurrentTaskSatisfied &&
              result.run2Output?.status === 'completed',
            {
              name: 'human-live-context-compaction-run2-writes-history-timeline',
              message:
                'Run 2 首次 brain 应为 system + 带 <memory> 的压缩 user + 过程 + 新任务 user，不能 System 后直接 AI；并再压至少一次。该次压缩的历史事实不能是「- 无」，须为能对上 Run 1 产物的时间线；当前交付/未解决应围绕对照、改标题或法务，而不是整段重填周报。',
              data: {
                startedEvents: run2Compaction.startedEvents,
                completedEvents: run2Compaction.completedEvents,
                run2FirstBrainRoles,
                compactionSummaries: run2Compaction.summaries,
                latestRun2Summary,
                run2HistorySection,
                run2CurrentSection,
                run2Status: result.run2Output?.status
              }
            }
          )
        }
      })
    })
  }, 3_600_000)
})
