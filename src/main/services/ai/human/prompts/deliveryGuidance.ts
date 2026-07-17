import type { HumanDecisionHint } from '../types'

const toDisplaySourcePath = (sourcePath: string | undefined): string =>
  sourcePath?.split(/[\\/]/).filter(Boolean).at(-1) || '目标 docx'

const renderPositionedDocxGuidance = (
  hint: Extract<HumanDecisionHint, { code: 'hand_docx_positioned_write_blocked' }>
): string => {
  const sourcePath = toDisplaySourcePath(hint.detail.sourcePath)
  return [
    `最终交付时必须说明：${sourcePath} 中${hint.detail.error}`,
    'AI 未自动修改该区域，需要用户手动按建议内容处理这部分版式区域。',
    '如果后续已经在其他可安全编辑的位置完成了修改，也要同时说明实际写入位置。'
  ].join('')
}

const renderToolLimitExceededGuidance = (
  hint: Extract<HumanDecisionHint, { code: 'hand_tool_limit_exceeded' }>
): string =>
  `本轮累计工具调用次数已经超过上限，当前为 ${String(hint.detail.toolCallCount)}，上限为 ${String(hint.detail.limit)}。后续没有继续执行更多工具。最终答复中需要明确说明：已经完成了什么、哪些事项尚未继续完成，以及停止原因是工具调用预算耗尽。`

export const renderDeliveryGuidanceForMouth = (
  hint: HumanDecisionHint | undefined
): string | undefined => {
  if (!hint) return undefined
  switch (hint.code) {
    case 'hand_docx_positioned_write_blocked':
      return renderPositionedDocxGuidance(hint)
    case 'hand_tool_limit_exceeded':
      return renderToolLimitExceededGuidance(hint)
    default:
      return undefined
  }
}
