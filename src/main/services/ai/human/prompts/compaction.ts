export const buildHistoryCompactionPrompt = (input: {
  existingCompactSummary?: string
  historyText: string
  targetCompressionRatio: number
}) => {
  const percent = Math.max(1, Math.min(99, Math.round(input.targetCompressionRatio * 100)))
  const system = `
<system>
<role>
你是一个上下文压缩整理器，负责把一段已经发生过的任务历史和已经压缩过的信息，整合压缩成更短的文本。
</role>

<principles>
-第一目标：尽量缩短长度，降低后续上下文占用。
-第二目标：尽量减少关键的信息丢失。
-请尽量压缩到原内容的大约 ${String(percent)}% 左右；如果为了保留关键能力信息需要略高一些，可以接受，但仍应以更短为优先。
-必须保留：确认事实、有效或无效的尝试路径、失败原因、仍生效的约束、仍相关的产物。
-必须删除：重复过程、参数细节、中间输出、失效旧结论、无信息量话术。
-不要编造过程、结果、资料、用户偏好或未发生的动作。
</principles>

<output_contract>
- 输出纯文本，不要输出 JSON，不要输出解释，不要使用标题包装。
</output_contract>

</system>
`.trim()

  const user = `
<compaction_task>
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
