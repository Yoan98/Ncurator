import { renderInlineList } from '../../utils/render'
import type { HumanLoadedHistoryContext, HumanRoundRecord } from '../types'
import { renderWatchHintForBrain } from '../prompts/watchHints'

const renderQuotedNames = (items: readonly string[]): string =>
  renderInlineList(
    items.map((item) => `\`${item}\``),
    {
      separator: '、',
      fallback: 'none'
    }
  )

const renderDecisionNextAction = (record: HumanRoundRecord): string => {
  switch (record.decision.nextAction.action) {
    case 'learning':
      return `- 你准备下一步做：准备学习 ${renderQuotedNames(
        record.decision.nextAction.wantLearnSkillIds
      )}。`
    case 'hand':
      return `- 你准备下一步做：准备进入 hand，${
        record.decision.nextAction.toolUsePlan.mode === 'parallel'
          ? `以 parallel 模式并行执行 ${renderQuotedNames(
              record.decision.nextAction.toolUsePlan.calls.map((call) => call.toolName)
            )}。`
          : `以 serial 模式按顺序执行 ${renderQuotedNames(
              record.decision.nextAction.toolUsePlan.calls.map((call) => call.toolName)
            )}。`
      }`
    case 'mouth':
      return '- 你准备下一步做：准备进入 mouth 组织最终交付。'
  }
}

const renderRoundDecision = (record: HumanRoundRecord): string =>
  `
- 你的判断：${record.decision.decision.summary}
- 你这样判断的原因：${record.decision.decision.reason}
- 你当时期待的结果：${record.decision.decision.expectedOutcome}
- ${record.decision.readyToDeliver ? '你当时认为已经可以交付。' : '你当时认为还不能直接交付。'}
${renderDecisionNextAction(record)}
`.trim()

const renderRoundExecution = (
  record: HumanRoundRecord,
  detail: 'focus' | 'chain' | 'loaded'
): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return '- 没有进入真实执行，系统在执行前阻断了这轮动作。'
    case 'learning':
      return '- 进入 learning，按请求尝试补齐外置技能。'
    case 'hand':
      return `
- 进入 hand，执行模式是 ${record.execution.toolUsePlan.mode}。
- ${
        record.execution.toolUsePlan.mode === 'parallel'
          ? `实际并行执行了 ${renderQuotedNames(record.execution.toolUsePlan.calls.map((call) => call.toolName))}。`
          : `实际按顺序执行了 ${renderQuotedNames(record.execution.toolUsePlan.calls.map((call) => call.toolName))}。`
      }
${detail !== 'chain' ? `- 本轮计划包含 ${record.execution.toolUsePlan.calls.length} 个工具调用。` : ''}
`
        .trim()
        .replace(/\n\n+/g, '\n')
    case 'mouth':
      return '- 进入 mouth，组织最终说明。'
  }
}

const renderRoundResult = (record: HumanRoundRecord): string => {
  switch (record.execution.kind) {
    case 'pre_execution_blocked':
      return renderWatchHintForBrain(record.execution.watchHint)
    case 'learning':
      return `
- 已加载的技能：${renderQuotedNames(record.execution.learningOutcome.loadedSkillIds)}
- 已跳过的重复技能：${renderQuotedNames(record.execution.learningOutcome.skippedDuplicateSkillIds)}
- 未识别的技能：${renderQuotedNames(record.execution.learningOutcome.skippedUnknownSkillIds)}
- 当前 active tool 数：${String(record.execution.learningOutcome.activeToolCount)}
${record.execution.watchHint ? `- 收敛提示：${renderWatchHintForBrain(record.execution.watchHint)}` : ''}
`
        .trim()
        .replace(/\n\n+/g, '\n')
    case 'hand': {
      const toolResultLines = record.execution.toolResults
        .map((result) =>
          [
            `- \`${result.toolName}\`：${result.summary}`,
            result.resourceContext
              ? `上下文：sourcePath=${result.resourceContext.sourcePath || 'none'}；currentVersion=${result.resourceContext.currentVersionRef || 'none'}${
                  result.resourceContext.previousVersionRef
                    ? `；previousVersion=${result.resourceContext.previousVersionRef}`
                    : ''
                }`
              : '',
            result.dataPreview ? `结果：${result.dataPreview}` : '',
            result.diagnosticText ? `诊断：${result.diagnosticText}` : ''
          ]
            .filter(Boolean)
            .join('；')
        )
        .join('\n')
      const artifactLine =
        record.execution.artifactRefs && record.execution.artifactRefs.length > 0
          ? `- 产物：${renderInlineList(
              record.execution.artifactRefs.map((artifact) =>
                artifact.kind === 'file'
                  ? `\`${artifact.fileName}\``
                  : `draft review ${artifact.review.reviewId}`
              ),
              {
                separator: '、',
                fallback: 'none'
              }
            )}`
          : ''
      const watchHintLine = record.execution.watchHint
        ? `- 收敛提示：${renderWatchHintForBrain(record.execution.watchHint)}`
        : ''

      return [toolResultLines, artifactLine, watchHintLine].filter(Boolean).join('\n')
    }
    case 'mouth':
      return `
- 输出摘要：${record.execution.summary}
${record.execution.completed ? '- 任务已完成。' : '- 任务未完成。'}
`.trim()
  }
}

const renderRoundRecord = (
  record: HumanRoundRecord,
  detail: 'focus' | 'chain' | 'loaded'
): string =>
  `
- 第 ${record.roundId} 轮

决策了什么：
${renderRoundDecision(record)}

做了什么：
${renderRoundExecution(record, detail)}

结果是什么：
${renderRoundResult(record)}
`.trim()

export const renderRoundSection = (input: {
  records: HumanRoundRecord[]
  detail: 'focus' | 'chain' | 'loaded'
}): string =>
  input.records.length > 0
    ? input.records.map((record) => renderRoundRecord(record, input.detail)).join('\n\n')
    : 'none'

export const renderLoadedHistoryText = (
  loadedHistoryContext: HumanLoadedHistoryContext | undefined
): string =>
  loadedHistoryContext
    ? `
过滤条件：query=${loadedHistoryContext.filters.query || 'none'}；startRoundId=${String(
        loadedHistoryContext.filters.startRoundId || 'none'
      )}；endRoundId=${String(loadedHistoryContext.filters.endRoundId || 'none')}；limit=${String(
        loadedHistoryContext.filters.limit || loadedHistoryContext.rounds.length
      )}

${renderRoundSection({
  records: loadedHistoryContext.rounds,
  detail: 'loaded'
})}
`
        .trim()
    : 'none'

export const renderUnifiedHistoryText = (input: {
  roundHistory: HumanRoundRecord[]
  loadedHistoryContext: HumanLoadedHistoryContext | undefined
}): string =>
  `
过程历史：
${renderRoundSection({
  records: input.roundHistory,
  detail: 'loaded'
})}

主动回看历史：
${renderLoadedHistoryText(input.loadedHistoryContext)}
`
    .trim()
    .replace(/\n{3,}/g, '\n\n')
