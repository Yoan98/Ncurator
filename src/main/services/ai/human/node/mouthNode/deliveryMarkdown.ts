import type { HumanDeliveryMode, HumanState } from '../../types'
import { buildStructuredDeliveryFallbackMarkdown } from '../../shared/deliveryContracts'
import {
  renderHumanEvidenceLines,
  renderHumanFactLines,
  renderHumanOpenQuestionLines
} from '../../shared/memoryRenderers'

const buildUserAnswerMarkdown = (state: HumanState, summary: string) =>
  [
    '# 处理结果',
    '',
    summary,
    '',
    '## 已确认事实',
    renderHumanFactLines(state, 'fallback_markdown'),
    '',
    '## 关键证据',
    renderHumanEvidenceLines(state, 'fallback_markdown'),
    '',
    '## 限制与未决项',
    renderHumanOpenQuestionLines(state, 'fallback_markdown')
  ].join('\n')

export const buildFallbackDeliveryMarkdown = (input: {
  state: HumanState
  deliveryMode: HumanDeliveryMode
  summary: string
}): string => {
  if (input.deliveryMode === 'task_handoff') {
    return buildStructuredDeliveryFallbackMarkdown({
      state: input.state,
      mode: 'task_handoff',
      summary: input.summary
    })
  }
  if (input.deliveryMode === 'context_note') {
    return buildStructuredDeliveryFallbackMarkdown({
      state: input.state,
      mode: 'context_note',
      summary: input.summary
    })
  }
  return buildUserAnswerMarkdown(input.state, input.summary)
}
