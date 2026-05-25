import type { JsonObject } from '../../../../../shared/types'
import type { HumanDecisionHint } from '../types'

const renderStringList = (items: readonly string[]): string =>
  items.length > 0 ? items.join('、') : '无'

const asJsonObject = (value: HumanDecisionHint['detail']): JsonObject => ({ ...value })

export const renderDecisionHintForBrain = (hint: HumanDecisionHint): string => {
  switch (hint.code) {
    case 'learning_no_effect':
      return `上一轮学习没有带来新能力。请求的技能有：${renderStringList(hint.detail.requestedSkillIds)}；重复的技能有：${renderStringList(hint.detail.duplicateSkillIds)}；不存在的技能有：${renderStringList(hint.detail.unknownSkillIds)}。`
    case 'terminal_approval_blocked':
      return [
        '上一轮 terminal 审批没有全部通过，因此相关命令本轮没有执行。',
        `已允许的命令有：${renderStringList(hint.detail.allowedCommands)}。`,
        `未执行的命令有：${renderStringList(hint.detail.blockedCommands)}。`,
        hint.detail.guidance.length > 0
          ? `用户补充说明的命令有：${hint.detail.guidance.map((item) => `${item.command}（${item.message}）`).join('、')}。`
          : undefined
      ]
        .filter(Boolean)
        .join('\n')
    case 'hand_call_limit_exceeded':
      return [
        '上一轮工具调用计划超过了单轮允许的调用数，因此没有进入执行。',
        `本轮计划调用数为 ${String(hint.detail.callCount)}，限制为 ${String(hint.detail.limit)}。`,
        `涉及的工具有：${renderStringList(hint.detail.offendingToolNames)}。`
      ]
        .filter(Boolean)
        .join('\n')
    case 'hand_docx_single_file_write_limit_exceeded':
      return [
        '上一轮 docx 写计划没有进入执行，因为同一文件在一轮中出现了多次写入。',
        `涉及的文件有：${renderStringList(hint.detail.sourcePaths)}。`,
        `涉及的工具有：${renderStringList(hint.detail.offendingToolNames)}。`
      ]
        .filter(Boolean)
        .join('\n')
    case 'hand_tool_limit_exceeded':
      return `累计工具调用次数已经超过当前上限。当前为 ${String(hint.detail.toolCallCount)}，上限为 ${String(hint.detail.limit)}。`
    case 'hand_tool_result_too_large':
      return `上一轮 ${hint.detail.toolName} 返回内容过大，估算约 ${String(hint.detail.estimatedTokens)} tokens，超过当前上限 ${String(hint.detail.limit)}，本轮结果不能原样继续带入后续判断。`
    case 'hand_docx_positioned_write_blocked':
      return `刚才尝试修改的 docx 区域命中了定位排版保护，系统没有自动修改该位置。受影响的位置是：${hint.detail.targetDescription}。`
    case 'brain_todolist_incomplete':
      return `上一轮选择了最终交付，但当前仍有未完成事项：${renderStringList(hint.detail.pendingItems)}。`
  }
}

export const renderDecisionHintDetail = (hint: HumanDecisionHint): JsonObject =>
  asJsonObject(hint.detail)
