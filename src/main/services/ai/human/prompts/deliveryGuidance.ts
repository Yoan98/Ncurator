import type { HumanDecisionHint } from '../types'

const toDisplaySourcePath = (sourcePath: string | undefined): string =>
  sourcePath?.split(/[\\/]/).filter(Boolean).at(-1) || '目标 docx'

const renderToolLimitExceededGuidance = (
  hint: Extract<HumanDecisionHint, { code: 'hand_tool_limit_exceeded' }>
): string =>
  `本轮累计工具调用次数已经超过上限，当前为 ${String(hint.detail.toolCallCount)}，上限为 ${String(hint.detail.limit)}。后续没有继续执行更多工具。最终答复中需要明确说明：已经完成了什么、哪些事项尚未继续完成，以及停止原因是工具调用预算耗尽。`

export const renderDeliveryGuidanceForMouth = (
  hint: HumanDecisionHint | undefined
): string | undefined => {
  if (!hint) return undefined
  switch (hint.code) {
    case 'hand_docx_positioned_write_blocked': {
      const sourcePath = toDisplaySourcePath(hint.detail.sourcePath)
      const regionText = hint.detail.error.match(/包含[“"]([^”"]{1,80})[”"]的区域/u)?.[1]
      const region = regionText ? `（命中区域：“${regionText}”）` : ''
      return `最终交付时必须说明：${sourcePath} 中该区域因使用 DOCX 绝对定位或锚定定位布局而无法安全完成正常排版，因此禁止编辑该区域${region}；可继续处理其他非定位区域，但禁止通过其他方式修改该区域。`
    }
    case 'hand_tool_limit_exceeded':
      return renderToolLimitExceededGuidance(hint)
    default:
      return undefined
  }
}
