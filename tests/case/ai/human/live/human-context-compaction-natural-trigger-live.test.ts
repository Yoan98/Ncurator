import { describe, it } from 'vitest'
import type { AiLlmIoRecord, AiRunEvent } from '../../../../../src/shared/types'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH,
  HUMAN_CONTEXT_COMPACTION_RUN1_USER_INPUT,
  HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT,
  HUMAN_CONTEXT_COMPACTION_USER_INPUT,
  loadContextCompactionWorkspaceSeed
} from '../../../../harness/backend/liveScenarios/contextCompactionScenario'
import {
  collectContinuationPrefixCacheReuse,
  continuationPrefixCacheAssertionData
} from '../../../../harness/core/continuation-prefix-cache'
import {
  collectSuccessfulDocxWriteSourcePaths,
  filterAiRunEventsByType,
  hasDocxDeliveryEvidence,
  isDocxContentCreateInput,
  runWithStructuredOutputRetry
} from '../testUtils'

const PARTNER_ID = 'live-context-compaction'
const LIVE_CONTEXT_COMPACTION_WINDOW_TOKENS = 60_000

const REQUIRED_COMPACTION_HEADINGS = [
  '## 目标',
  '## 约束与偏好',
  '## 进度',
  '## 关键决策',
  '## 下一步',
  '## 关键上下文'
] as const

const expectedLastWeekDocAnchor = '上周周报'
const inventedLastWeekDocName = '上周工作周报.docx'
const COMPACTION_CHECKPOINT_MARKER = 'compacted into the following summary'

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
  if (roles.length < 2) return false
  if (roles[0] !== 'system' || roles[1] !== 'human') return false
  if (!record.user.includes('<summary>') || !record.user.includes(COMPACTION_CHECKPOINT_MARKER)) {
    return false
  }
  return roles.slice(2).every((role) => role === 'ai' || role === 'tool' || role === 'human')
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

const pickCompactionCut = (
  event:
    | Extract<AiRunEvent, { type: 'context_compaction_started' }>
    | Extract<AiRunEvent, { type: 'context_compaction_completed' }>
) => ({
  type: event.type,
  throughSeq: event.throughSeq,
  firstKeptSeq: event.firstKeptSeq,
  historyFloorSeq: event.historyFloorSeq,
  historyFloorKind: event.historyFloorKind,
  isSplitTurn: event.isSplitTurn,
  foldedCount: event.foldedCount,
  tailCount: event.tailCount,
  ...(event.type === 'context_compaction_completed'
    ? { compactBlockId: event.compactBlockId }
    : {})
})

const hasValidCompactionCut = (
  event:
    | Extract<AiRunEvent, { type: 'context_compaction_started' }>
    | Extract<AiRunEvent, { type: 'context_compaction_completed' }>
): boolean => {
  const foldedCount =
    event.type === 'context_compaction_started'
      ? event.targetMessageCount
      : event.sourceMessageCount
  return (
    Number.isInteger(event.throughSeq) &&
    event.throughSeq >= 1 &&
    (event.firstKeptSeq === undefined || event.firstKeptSeq > event.throughSeq) &&
    Number.isInteger(event.historyFloorSeq) &&
    (event.historyFloorKind === 'compaction' || event.historyFloorKind === 'none') &&
    typeof event.isSplitTurn === 'boolean' &&
    event.foldedCount >= 1 &&
    event.tailCount >= 0 &&
    event.foldedCount === foldedCount
  )
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
  const summaries = completedEvents
    .map((event) => String(event.summaryPreview || '').trim())
    .filter((summary) => summary.length > 0)
  return {
    startedEvents,
    completedEvents,
    budgetEvents,
    compactionRecords,
    summaries,
    lifecycleSatisfied:
      startedEvents.length >= 1 &&
      completedEvents.length === startedEvents.length &&
      compactionRecords.length >= completedEvents.length &&
      budgetEvents.some(
        (event) =>
          event.decision === 'compact' &&
          event.snapshot.basis === 'usage_plus_delta' &&
          event.snapshot.budgetTokens > event.snapshot.compactionTriggerTokens
      )
  }
}

const lastBrainRecord = (records: readonly AiLlmIoRecord[]): AiLlmIoRecord | undefined =>
  [...records].reverse().find((record) => record.caller === 'human.brain')

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
          '验证 live 模式下 human 在普通短问之后的周报长任务中会自然触发压缩；同一次可走历史+半截；压完后以 System + Compact User + 原文 tail 交付；Run 2 未压出 checkpoint 则不发 Run 3；续做再压，且 Run3 首轮 brain 须明显复用 Run2 末次前缀缓存。',
        fixtures: [CONTEXT_COMPACTION_SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        messageLogAnnotationPartnerIds: () => [PARTNER_ID],
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
            userInput: HUMAN_CONTEXT_COMPACTION_RUN1_USER_INPUT
          })
          const run1Events = runtime.eventCollector.snapshot()
          const run1LlmIo = runtime.eventCollector.snapshotLlmIo()
          const run2Output = await createHumanTestRunner(runtime, runnerOptions).run({
            taskId: `${runtime.taskId}-run-2`,
            userInput: HUMAN_CONTEXT_COMPACTION_USER_INPUT
          })
          const afterRun2Events = runtime.eventCollector.snapshot()
          const afterRun2LlmIo = runtime.eventCollector.snapshotLlmIo()
          const run2Events = afterRun2Events.slice(run1Events.length)
          const run2LlmIo = afterRun2LlmIo.slice(run1LlmIo.length)
          const run2Compacted =
            collectRunCompaction({
              events: run2Events,
              llmIoRecords: run2LlmIo
            }).completedEvents.length >= 1
          if (!run2Compacted) {
            return {
              workspaceSeed,
              run1Output,
              run2Output,
              run3Output: undefined,
              run1Events,
              run2Events,
              run3Events: [],
              run1LlmIo,
              run2LlmIo,
              run3LlmIo: []
            }
          }
          const run3Output = await createHumanTestRunner(runtime, runnerOptions).run({
            taskId: `${runtime.taskId}-run-3`,
            userInput: HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT
          })
          const allEvents = runtime.eventCollector.snapshot()
          const allLlmIo = runtime.eventCollector.snapshotLlmIo()
          return {
            workspaceSeed,
            run1Output,
            run2Output,
            run3Output,
            run1Events,
            run2Events,
            run3Events: allEvents.slice(afterRun2Events.length),
            run1LlmIo,
            run2LlmIo,
            run3LlmIo: allLlmIo.slice(afterRun2LlmIo.length)
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
          const run3Compaction = collectRunCompaction({
            events: result.run3Events,
            llmIoRecords: result.run3LlmIo
          })
          const run2Docx = collectDocxEvidence({
            events: result.run2Events,
            artifacts: result.run2Output?.artifacts
          })
          const compactionPromptOk = (record: AiLlmIoRecord): boolean =>
            !record.user.includes('<current>') &&
            !record.user.includes('<earlier>') &&
            !record.user.includes('<previous-summary>') &&
            !record.user.includes('[round') &&
            record.user.includes('<conversation>')
          const checkpointFormatOk = (summaries: readonly string[]): boolean =>
            summaries.length > 0 &&
            summaries.every(
              (summary) =>
                REQUIRED_COMPACTION_HEADINGS.every((heading) => summary.includes(heading)) ||
                summary.includes('**Turn Context (split turn):**')
            )
          const run2PostCompactBrain = firstBrainAfterCompaction(result.run2LlmIo)
          const run2LatestBrain = lastBrainRecord(result.run2LlmIo)
          const run2SummaryQualitySatisfied = run2Compaction.summaries.every(
            (summary) =>
              summary.includes(expectedLastWeekDocAnchor) &&
              !summary.includes(inventedLastWeekDocName)
          )
          const run2TaskCompletionSatisfied =
            result.run2Output?.status === 'completed' &&
            (run2Docx.toolNames.some((toolName) => toolName.startsWith('docx_')) ||
              run2Docx.toolNames.includes('text_file_edit'))
          const run3PrefixCache = collectContinuationPrefixCacheReuse({
            previousLlmIo: result.run2LlmIo,
            nextLlmIo: result.run3LlmIo
          })
          const run3FirstBrain = run3PrefixCache.nextFirstBrain
          const run3FirstBrainRoles = run3FirstBrain
            ? parseBrainMessageRoles(run3FirstBrain.user)
            : []

          const latestRun3Summary = run3Compaction.summaries.at(-1) || ''
          const run3CurrentSection = [
            extractSection(latestRun3Summary, '## 目标'),
            extractSection(latestRun3Summary, '## 进度'),
            extractSection(latestRun3Summary, '## 下一步'),
            extractSection(latestRun3Summary, '## 约束与偏好')
          ].join('\n')

          runtime.assertThat(result.run1Output?.status === 'completed', {
            name: 'human-live-context-compaction-run1-ordinary-question',
            message: 'Run 1 应为普通短问并正常完成，用来铺出一条完整历史轮。',
            data: {
              run1Status: result.run1Output?.status,
              run1CompactionCount: run1Compaction.completedEvents.length
            }
          })

          runtime.assertThat(
            run2Compaction.lifecycleSatisfied &&
              run2Compaction.startedEvents.every(hasValidCompactionCut) &&
              run2Compaction.completedEvents.every(hasValidCompactionCut) &&
              checkpointFormatOk(run2Compaction.summaries) &&
              run2Compaction.compactionRecords.every(compactionPromptOk) &&
              run2SummaryQualitySatisfied &&
              Boolean(run2PostCompactBrain && isCompactedBrainShape(run2PostCompactBrain)) &&
              Boolean(run2LatestBrain?.user.includes(expectedLastWeekDocAnchor)) &&
              Boolean(run2LatestBrain && !run2LatestBrain.user.includes(inventedLastWeekDocName)) &&
              Boolean(run2LatestBrain?.user.includes(COMPACTION_CHECKPOINT_MARKER)) &&
              run2TaskCompletionSatisfied &&
              run2Docx.artifactSatisfied,
            {
              name: 'human-live-context-compaction-run2-completes-weekly-report',
              message:
                'Run 2 应至少压缩一次；落库 checkpoint 为六栏或含 Turn Context，含「上周周报」、不编造「上周工作周报.docx」；压完后 brain 为 system + Compact User + 原文 tail，并成功交付周报。',
              data: {
                compactionCuts: [
                  ...run2Compaction.startedEvents,
                  ...run2Compaction.completedEvents
                ].map(pickCompactionCut),
                summaryHeadingsOk: checkpointFormatOk(run2Compaction.summaries),
                compactionCallCount: run2Compaction.compactionRecords.length,
                postCompactBrainRoles: run2PostCompactBrain
                  ? parseBrainMessageRoles(run2PostCompactBrain.user)
                  : [],
                toolNames: run2Docx.toolNames,
                artifactKinds: (result.run2Output?.artifacts || []).map(
                  (artifact) => artifact.kind || artifact.capability || ''
                )
              }
            }
          )

          if (!result.run3Output) {
            return
          }

          const run3FirstBrainSatisfied =
            Boolean(run3FirstBrain?.user.includes(COMPACTION_CHECKPOINT_MARKER)) &&
            Boolean(run3FirstBrain?.user.includes('<summary>')) &&
            run3FirstBrainRoles[0] === 'system' &&
            run3FirstBrainRoles[1] === 'human' &&
            run3FirstBrainRoles.at(-1) === 'human' &&
            Boolean(run3FirstBrain?.user.includes(HUMAN_CONTEXT_COMPACTION_RUN2_USER_INPUT)) &&
            run3FirstBrainRoles[1] !== 'ai' &&
            run3FirstBrainRoles[1] !== 'tool'
          const run3HistorySatisfied =
            run3Compaction.summaries.length > 0 &&
            (REQUIRED_COMPACTION_HEADINGS.every((heading) =>
              latestRun3Summary.includes(heading)
            ) ||
              latestRun3Summary.includes('**Turn Context (split turn):**')) &&
            !latestRun3Summary.includes('记忆时间线：') &&
            (latestRun3Summary.includes(expectedLastWeekDocAnchor) ||
              /\.docx|周报/.test(latestRun3Summary))
          const run3CurrentTaskSatisfied =
            /(对照|标题|九月|法务)/.test(run3CurrentSection) &&
            !/从空白模板整份|整份重填周报/.test(
              run3CurrentSection.replace(/不(?:要)?从空白模板整份重填周报/g, '')
            )

          runtime.assertThat(
            run3Compaction.lifecycleSatisfied &&
              run3Compaction.startedEvents.every(hasValidCompactionCut) &&
              run3Compaction.completedEvents.every(hasValidCompactionCut) &&
              run3FirstBrainSatisfied &&
              run3HistorySatisfied &&
              run3CurrentTaskSatisfied &&
              run3Compaction.compactionRecords.every(compactionPromptOk) &&
              result.run3Output?.status === 'completed',
            {
              name: 'human-live-context-compaction-run3-continues-from-compaction-user',
              message:
                'Run 3 首次 brain 应为 system + Compact User + 原文过程 + 新任务 user，不能 System 后直接 AI；并再压至少一次。落库摘要只要六栏（半轮可含 Turn Context），目标/进度/下一步/约束与偏好应围绕对照、改标题或法务。',
              data: {
                compactionCuts: [
                  ...run3Compaction.startedEvents,
                  ...run3Compaction.completedEvents
                ].map(pickCompactionCut),
                run3FirstBrainRoles,
                latestRun3SummaryHeadings: REQUIRED_COMPACTION_HEADINGS.filter((heading) =>
                  latestRun3Summary.includes(heading)
                ),
                run3CurrentSection,
                run3Status: result.run3Output?.status
              }
            }
          )

          runtime.assertThat(run3PrefixCache.satisfied, {
            name: 'human-live-context-compaction-run3-reuses-run2-prefix-cache',
            message:
              '发第三次 user 续跑时，Run3 首次 brain 的 cachedInputTokens 应明显复用 Run2 末次 brain 的 inputTokens 前缀；低于公用跨 run 比例门槛说明前缀被改写或缓存未命中。',
            data: continuationPrefixCacheAssertionData(run3PrefixCache)
          })
        }
      })
    })
  }, 3_600_000)
})
