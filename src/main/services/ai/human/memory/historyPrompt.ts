import { renderLineList } from '../../utils/render'
import { renderWatchHintForBrain } from '../prompts/watchHints'
import type {
  HumanLoadedHistoryContext,
  HumanRoundExecution,
  HumanRoundRecord,
  HumanState,
  LastBrainDecision,
  ToolUsePlan
} from '../types'
import {
  getHistoryChainRounds,
  getLastRoundFocus,
  getLoadedHistoryContext
} from './roundHistory'

type HumanHistoryPromptDetail = 'focus' | 'chain' | 'loaded'

const compactLines = (items: Array<string | undefined>): string[] =>
  items.filter((item): item is string => Boolean(item))

const renderStringList = (items: readonly string[]): string =>
  items.length > 0 ? items.join('、') : 'none'

const renderReadyToDeliverText = (readyToDeliver: boolean): string =>
  readyToDeliver ? '你当时认为已经可以交付。' : '你当时认为还不能直接交付。'

const renderToolUsePlanText = (toolUsePlan: ToolUsePlan): string => {
  const toolNames = toolUsePlan.calls.map((call) => `\`${call.toolName}\``)
  return toolUsePlan.mode === 'parallel'
    ? `以 parallel 模式并行执行 ${renderStringList(toolNames)}。`
    : `以 serial 模式按顺序执行 ${renderStringList(toolNames)}。`
}

const renderNextActionText = (decision: LastBrainDecision): string => {
  if (decision.nextAction.action === 'learning') {
    return `准备学习 ${renderStringList(decision.nextAction.wantLearnSkillIds.map((skillId) => `\`${skillId}\``))}。`
  }

  if (decision.nextAction.action === 'hand') {
    return `准备进入 hand，${renderToolUsePlanText(decision.nextAction.toolUsePlan)}`
  }

  return '准备进入 mouth 组织最终交付。'
}

const renderDecisionLines = (decision: LastBrainDecision): string[] => [
  `- 你的判断：${decision.decision.summary}`,
  `- 你这样判断的原因：${decision.decision.reason}`,
  `- 你当时期待的结果：${decision.decision.expectedOutcome}`,
  `- ${renderReadyToDeliverText(decision.readyToDeliver)}`,
  `- 你准备下一步做：${renderNextActionText(decision)}`
]

const renderExecutionLines = (
  execution: HumanRoundExecution,
  detail: HumanHistoryPromptDetail
): string[] => {
  if (execution.kind === 'pre_execution_blocked') {
    return ['- 没有进入真实执行，系统在执行前阻断了这轮动作。']
  }

  if (execution.kind === 'learning') {
    return ['- 进入 learning，按请求尝试补齐外置技能。']
  }

  if (execution.kind === 'hand') {
    const toolNames = execution.toolUsePlan.calls.map((call) => `\`${call.toolName}\``)
    return compactLines([
      `- 进入 hand，执行模式是 ${execution.toolUsePlan.mode}。`,
      execution.toolUsePlan.mode === 'parallel'
        ? `- 实际并行执行了 ${renderStringList(toolNames)}。`
        : `- 实际按顺序执行了 ${renderStringList(toolNames)}。`,
      detail === 'focus' || detail === 'loaded'
        ? `- 本轮计划包含 ${execution.toolUsePlan.calls.length} 个工具调用。`
        : undefined
    ])
  }

  return ['- 进入 mouth，组织最终说明。']
}

const renderExecutionResultLines = (
  execution: HumanRoundExecution
): string[] => {
  if (execution.kind === 'pre_execution_blocked') {
    return [renderWatchHintForBrain(execution.watchHint)]
  }

  if (execution.kind === 'learning') {
    return compactLines([
      `- 已加载的技能：${renderStringList(
        execution.learningOutcome.loadedSkillIds.map((skillId) => `\`${skillId}\``)
      )}`,
      `- 已跳过的重复技能：${renderStringList(
        execution.learningOutcome.skippedDuplicateSkillIds.map((skillId) => `\`${skillId}\``)
      )}`,
      `- 未识别的技能：${renderStringList(
        execution.learningOutcome.skippedUnknownSkillIds.map((skillId) => `\`${skillId}\``)
      )}`,
      `- 当前 active tool 数：${String(execution.learningOutcome.activeToolCount)}`,
      execution.watchHint ? `- 收敛提示：${renderWatchHintForBrain(execution.watchHint)}` : undefined
    ])
  }

  if (execution.kind === 'hand') {
    const toolResultLines = execution.toolResults.map((result) =>
      [
        `- \`${result.toolName}\`：${result.summary}`,
        result.dataPreview ? `结果：${result.dataPreview}` : undefined,
        result.diagnosticText ? `诊断：${result.diagnosticText}` : undefined
      ]
        .filter(Boolean)
        .join('；')
    )

    return compactLines([
      ...toolResultLines,
      execution.artifactRefs && execution.artifactRefs.length > 0
        ? `- 产物：${renderStringList(
            execution.artifactRefs.map((artifact) =>
              artifact.kind === 'file' ? `\`${artifact.fileName}\`` : `draft review ${artifact.review.reviewId}`
            )
          )}`
        : undefined,
      execution.watchHint ? `- 收敛提示：${renderWatchHintForBrain(execution.watchHint)}` : undefined
    ])
  }

  return [
    `- 输出摘要：${execution.summary}`,
    execution.completed ? '- 任务已完成。' : '- 任务未完成。'
  ]
}

const renderRoundRecord = (
  record: HumanRoundRecord,
  detail: HumanHistoryPromptDetail
): string =>
  [
    `- 第 ${record.roundId} 轮`,
    '',
    '决策了什么：',
    renderLineList(renderDecisionLines(record.decision), {
      fallback: 'none',
      style: 'plain'
    }),
    '',
    '做了什么：',
    renderLineList(renderExecutionLines(record.execution, detail), {
      fallback: 'none',
      style: 'plain'
    }),
    '',
    '结果是什么：',
    renderLineList(renderExecutionResultLines(record.execution), {
      fallback: 'none',
      style: 'plain'
    })
  ].join('\n')

const renderRoundSection = (input: {
  intro: string
  records: HumanRoundRecord[]
  detail: HumanHistoryPromptDetail
  fallback: string
}): string =>
  [
    input.intro,
    '',
    renderLineList(
      input.records.map((record) => renderRoundRecord(record, input.detail)),
      {
        fallback: input.fallback,
        style: 'plain'
      }
    )
  ].join('\n')

export const buildLastRoundFocusText = (state: HumanState): string => {
  const record = getLastRoundFocus(state)
  return renderRoundSection({
    intro: '这是你上一轮最重要的完整闭环，优先据此判断下一步。',
    records: record ? [record] : [],
    detail: 'focus',
    fallback: 'none'
  })
}

export const buildHistoryChainText = (state: HumanState): string =>
  renderRoundSection({
    intro: '这是更早几轮的过程历史，只用于识别重复尝试、失败模式和已经验证过的路径。',
    records: getHistoryChainRounds(state),
    detail: 'chain',
    fallback: 'none'
  })

const renderLoadedHistoryIntro = (
  loadedHistoryContext: HumanLoadedHistoryContext | undefined
): string => {
  if (!loadedHistoryContext) {
    return '这是你主动加载的更详细历史。只有在你明确调用 history-recall 后才会出现。'
  }

  const filters = loadedHistoryContext.filters
  return [
    '这是你主动加载的更详细历史。只有在你明确调用 history-recall 后才会出现。',
    `本次过滤条件：roundIds=${renderStringList((filters.roundIds || []).map(String))}；executionKinds=${renderStringList(filters.executionKinds || [])}；toolNames=${renderStringList(
      filters.toolNames || []
    )}；watchHintCodes=${renderStringList(filters.watchHintCodes || [])}；limit=${String(filters.limit || loadedHistoryContext.rounds.length)}。`
  ].join('\n')
}

export const buildLoadedHistoryContextText = (state: HumanState): string => {
  const loadedHistoryContext = getLoadedHistoryContext(state)
  return renderRoundSection({
    intro: renderLoadedHistoryIntro(loadedHistoryContext),
    records: loadedHistoryContext?.rounds || [],
    detail: 'loaded',
    fallback: 'none'
  })
}
