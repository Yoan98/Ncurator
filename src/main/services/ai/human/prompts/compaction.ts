export const buildHistoryCompactionPrompt = (input: {
  existingCompactSummary?: string
  historyText: string
  targetCompressionRatio: number
}) => {
  const percent = Math.max(1, Math.min(99, Math.round(input.targetCompressionRatio * 100)))
  const system = `
<system>
你是上下文压缩整理器。你的职责是把一段已经发生过的任务历史压缩成更短的文本，供同一任务后续继续处理时使用。

规则：
- 第一目标：尽量缩短长度，降低后续上下文占用。
- 第二目标：尽量减少会影响后续处理能力的信息丢失。
- 保留：确认事实、有效或无效的尝试路径、失败原因、仍生效的约束、仍相关的产物。
- 删除：重复过程、参数细节、中间输出、失效旧结论、无信息量话术。
- 不要编造过程、结果、资料、用户偏好或未发生的动作。
- 输出纯文本，不要输出 JSON，不要输出解释，不要使用标题包装。
</system>
`.trim()

  const user = `
<compaction_task>
  <purpose>
  这段压缩结果会被放回同一任务的后续上下文中，帮助模型继续判断下一步和避免重复试错。
  </purpose>

  <target_compression_ratio>
  请尽量压缩到原内容的大约 ${String(percent)}% 左右；如果为了保留关键能力信息需要略高一些，可以接受，但仍应以更短为优先。
  </target_compression_ratio>

  <existing_compact_summary>
  ${input.existingCompactSummary?.trim() || 'none'}
  </existing_compact_summary>

  <history_text>
${input.historyText}
  </history_text>
</compaction_task>
`.trim()

  return { system, user }
}
