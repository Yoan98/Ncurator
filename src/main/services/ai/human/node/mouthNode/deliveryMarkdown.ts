import type { HumanDeliveryMode, HumanState } from '../../types'
import { renderLineList } from '../../../utils/render'

const renderBulletLines = (lines: string[]): string =>
  renderLineList(lines, {
    fallback: '无',
    style: 'bullet'
  })

const renderFactLines = (state: HumanState): string =>
  renderBulletLines(state.brainMemory.inside.facts.map((fact) => fact.summary))

const renderEvidenceLines = (state: HumanState): string =>
  renderBulletLines(
    state.brainMemory.inside.evidences.map((evidence) =>
      evidence.rawRef
        ? `${evidence.toolName}: ${evidence.summary} (${evidence.rawRef})`
        : `${evidence.toolName}: ${evidence.summary}`
    )
  )

const renderOpenQuestionLines = (state: HumanState): string =>
  renderBulletLines(state.brainMemory.inside.openQuestions)

const buildUserAnswerMarkdown = (state: HumanState, finalStatus: 'completed' | 'blocked', summary: string) =>
  [
    finalStatus === 'completed' ? '# 处理结果' : '# 当前阻塞说明',
    '',
    summary,
    '',
    '## 已确认事实',
    renderFactLines(state),
    '',
    '## 关键证据',
    renderEvidenceLines(state),
    '',
    '## 未决项',
    renderOpenQuestionLines(state)
  ].join('\n')

const buildTaskHandoffMarkdown = (
  state: HumanState,
  finalStatus: 'completed' | 'blocked',
  summary: string
) => {
  const defaultNextStep =
    finalStatus === 'completed'
      ? state.lastBrainDecision?.decision.expectedOutcome || '可基于以上结论继续后续任务。'
      : state.lastBrainDecision?.decision.expectedOutcome || '需先解决当前阻塞后再继续后续任务。'

  return [
    '# 子任务交付',
    '',
    '## 任务状态',
    finalStatus,
    '',
    '## 本任务结论',
    summary,
    '',
    '## 已完成',
    renderBulletLines([state.lastBrainDecision?.decision.summary || summary]),
    '',
    '## 关键事实',
    renderFactLines(state),
    '',
    '## 关键证据',
    renderEvidenceLines(state),
    '',
    '## 产物与引用',
    '无',
    '',
    '## 未决与风险',
    renderOpenQuestionLines(state),
    '',
    '## 对后续任务的影响',
    renderBulletLines([
      finalStatus === 'completed'
        ? '后续任务可以直接继承以上已确认事实与证据。'
        : '后续任务需要先处理当前阻塞或调整执行路径。'
    ]),
    '',
    '## 建议下一步',
    renderBulletLines([defaultNextStep])
  ].join('\n')
}

const buildContextNoteMarkdown = (
  state: HumanState,
  finalStatus: 'completed' | 'blocked',
  summary: string
) =>
  [
    '# 上下文补充结果',
    '',
    '## 当前状态',
    finalStatus,
    '',
    '## 可复用证据',
    renderEvidenceLines(state),
    '',
    '## 当前边界',
    renderBulletLines([
      state.lastBrainDecision?.decision.summary || summary,
      state.lastBrainDecision?.decision.reason || '当前边界以已确认事实和证据为准。'
    ]),
    '',
    '## 未决项',
    renderOpenQuestionLines(state),
    '',
    '## 建议补充方向',
    renderBulletLines([state.lastBrainDecision?.decision.expectedOutcome || '无'])
  ].join('\n')

export const buildFallbackDeliveryMarkdown = (input: {
  state: HumanState
  deliveryMode: HumanDeliveryMode
  finalStatus: 'completed' | 'blocked'
  summary: string
}): string => {
  if (input.deliveryMode === 'task_handoff') {
    return buildTaskHandoffMarkdown(input.state, input.finalStatus, input.summary)
  }
  if (input.deliveryMode === 'context_note') {
    return buildContextNoteMarkdown(input.state, input.finalStatus, input.summary)
  }
  return buildUserAnswerMarkdown(input.state, input.finalStatus, input.summary)
}
