import type { JsonObject } from '../../../../../shared/types'
import type { HumanDecisionHint } from '../types'

const renderStringList = (items: readonly string[]): string =>
  items.length > 0 ? items.join('、') : '无'

const asJsonObject = (value: HumanDecisionHint['detail']): JsonObject => ({ ...value })

export const renderDecisionHintForBrain = (hint: HumanDecisionHint): string => {
  switch (hint.code) {
    case 'run_resumed_after_interruption':
      return [
        `上一次运行因${
          {
            timeout: '请求超时',
            network_error: '网络错误',
            user_cancelled: '用户主动停止',
            process_interrupted: '运行进程中断',
            runtime_limit: '达到运行上限',
            unexpected_error: '未知运行异常'
          }[hint.detail.reason]
        }而中断，已恢复最近一次上下文信息，请根据 task_goal 和 resume_messages 继续推进`
      ].join('\n')
    case 'learning_no_effect':
      return `上一轮学习没有带来新能力。请求的技能有：${renderStringList(hint.detail.requestedSkillIds)}；重复的技能有：${renderStringList(hint.detail.duplicateSkillIds)}；不存在的技能有：${renderStringList(hint.detail.unknownSkillIds)}。`
    case 'terminal_approval_blocked':
      return [
        '上一轮 terminal 审批没有全部通过，因此相关命令本轮没有执行。',
        `已允许的命令有：${renderStringList(hint.detail.allowedCommands)}。`,
        `未执行的命令有：${renderStringList(hint.detail.blockedCommands)}。`,
        hint.detail.notes.length > 0
          ? `用户补充说明的命令有：${hint.detail.notes.map((item) => `${item.command}（${item.message}）`).join('、')}。`
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
    case 'legacy_doc_edit_unsupported':
      return hint.detail.instruction
    case 'hand_docx_edit_failed':
      return [
        '上一轮 docx_edit 写入失败，需要根据失败信息调整后续方案。',
        hint.detail.sourcePath ? `文件：${hint.detail.sourcePath}。` : undefined,
        hint.detail.action ? `actions：${hint.detail.action}。` : undefined,
        `错误：${hint.detail.error}。`
      ]
        .filter(Boolean)
        .join('\n')
    case 'hand_docx_positioned_write_blocked': {
      const regionText = hint.detail.error.match(/包含[“"]([^”"]{1,80})[”"]的区域/u)?.[1]
      const region = regionText ? `（命中区域：“${regionText}”）` : ''
      return `该区域因使用 DOCX 绝对定位或锚定定位布局而无法安全自动编辑${region}；可继续处理其他非定位区域，该区域需要用户手动处理。`
    }
    case 'hand_tool_limit_near_exhausted':
      return `累计工具调用次数已接近当前上限。当前为 ${String(hint.detail.toolCallCount)}，上限为 ${String(hint.detail.limit)}。后续应尽快收尾，只保留完成最终交付所必需的动作。`
    case 'hand_tool_limit_exceeded':
      return `累计工具调用次数已经超过当前上限。当前为 ${String(hint.detail.toolCallCount)}，上限为 ${String(hint.detail.limit)}。后续不应再继续调用工具，应直接进入最终交付，并明确说明哪些事项因工具预算耗尽而未继续完成。`
    case 'hand_tool_result_too_large':
      return `上一轮 ${hint.detail.toolName} 返回内容过大，估算约 ${String(hint.detail.estimatedTokens)} tokens，超过当前上限 ${String(hint.detail.limit)}，本轮结果不能原样继续带入后续判断。`
    case 'hand_tool_result_unusable':
      return `上一轮 ${hint.detail.toolName} 返回结果不可消费，系统已省略原始输出。检测到非文本/二进制特征：totalChars=${String(hint.detail.totalChars)}，nulCount=${String(hint.detail.nulCount)}，replacementCharRatio=${String(hint.detail.replacementCharRatio)}，controlCharRatio=${String(hint.detail.controlCharRatio)}，matchedSignatures=${renderStringList(hint.detail.matchedSignatures)}。`
    case 'brain_output_schema_invalid':
      return [
        '上一轮决策输出结构不合法，因此没有进入可执行节点。',
        ...hint.detail.issues.map((issue) => `${issue.path}：${issue.message}`)
      ].join('\n')
    case 'hand_call_invalid':
      return [
        '上一轮 hand 工具调用计划中存在不合法调用，因此本轮没有进入执行。',
        ...hint.detail.invalidCalls.map(
          (item) => `calls[${String(item.callIndex)}] 的工具 \`${item.toolName}\`：${item.message}`
        )
      ].join('\n')
    case 'brain_content_safety':
      return hint.detail.message
    case 'brain_todolist_incomplete':
      return `上一轮选择了最终交付，但任务清单中仍有未完成事项：${renderStringList(hint.detail.pendingItems)}。必须完成这些事项后且标为done才能进行最终交付。`
  }
}

export const renderDecisionHintDetail = (hint: HumanDecisionHint): JsonObject =>
  asJsonObject(hint.detail)
