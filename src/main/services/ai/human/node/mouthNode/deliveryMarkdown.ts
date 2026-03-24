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

const buildUserAnswerMarkdown = (state: HumanState, summary: string) =>
  [
    '# 处理结果',
    '',
    summary,
    '',
    '## 已确认事实',
    renderFactLines(state),
    '',
    '## 关键证据',
    renderEvidenceLines(state),
    '',
    '## 限制与未决项',
    renderOpenQuestionLines(state)
  ].join('\n')

const buildTaskHandoffMarkdown = (state: HumanState, summary: string) => {
  const defaultNextStep =
    state.lastBrainDecision?.decision.expectedOutcome || '可基于以上结论继续后续任务。'
  return [
    '# 子任务交付',
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
    renderBulletLines(['后续任务应结合以上已确认事实、证据和限制继续推进。']),
    '',
    '## 建议下一步',
    renderBulletLines([defaultNextStep])
  ].join('\n')
}

const buildContextNoteMarkdown = (state: HumanState, summary: string) =>
  [
    '# 上下文补充结果',
    '',
    '## 本轮结论',
    summary,
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
  summary: string
}): string => {
  if (input.deliveryMode === 'task_handoff') {
    return buildTaskHandoffMarkdown(input.state, input.summary)
  }
  if (input.deliveryMode === 'context_note') {
    return buildContextNoteMarkdown(input.state, input.summary)
  }
  return buildUserAnswerMarkdown(input.state, input.summary)
}
