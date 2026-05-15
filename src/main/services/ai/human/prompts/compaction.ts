export const buildHistoryCompactionPrompt = (input: {
  userGoal: string
  taskProgress: string
  existingCompactSummary?: string
  historyRounds: string
  targetCompressionRatio: number
}) => {
  const percent = Math.max(1, Math.min(99, Math.round(input.targetCompressionRatio * 100)))
  const system = `
<system>
<role>
你是一个上下文压缩整理器，负责把一段已经发生过的任务历史和已经压缩过的信息，整合压缩成更短的文本。
</role>

<principles>
- 第一目标：缩短长度，尽量压缩到原内容的大约 ${String(percent)}% 左右。
- 第二目标：保留与当前目标仍相关的客观事实，并缩小无效与重复内容。
- 必须保留：已确认事实、仍有效约束、仍影响任务推进的未解决问题、与当前目标仍相关的失败原因。
- 必须强力压缩：重复尝试、低价值中间过程、无法直接支撑目标覆盖的搜索噪声、重复参数细节。
- 可以降级为背景：仅用于解释上下文但已不再影响当前目标推进的信息。
- 禁止编造过程、结果、资料、用户偏好或未发生的动作。
- 禁止对客观事实进行多余描述，比如文件名、路径、资料名、工具名、人物职责绑定等已经有明确标识的对象，必须复用原文锚点。
</principles>

<context_block_guide>
    - user_goal：用户原始诉求。
    - task_progress：当前任务的全局进度信；只用于判断当前什么仍相关、什么已经失效、什么尝试其实没有解决问题；它不能覆盖或改写历史事实。
    - existing_compact_summary：之前压缩的总结信息；如果之前已经有过压缩总结，则本次压缩需要在它的基础上进行迭代压缩。
    - history_rounds：当前任务已发生的历史轮次信息，包含所有细节；它是本次压缩的主要依据。
  </context_block_guide>

<output_contract>
- 输出纯文本，不要输出 JSON，不要输出解释。
- 必须严格使用以下固定结构与标题，不要新增或删减段落：
任务锚点：
- 目标：...
- 当前交付：...

已确认事实：
- ...

仍有效约束：
- ...

已尝试但未解决：
- ...

重复或低价值内容：
- ...

已失效或仅作背景的信息：
- ...
</output_contract>


</system>
`.trim()

  const user = `
<compaction_task>
  <user_goal>
${input.userGoal.trim() || 'none'}
  </user_goal>

  <task_progress>
${input.taskProgress.trim() || 'none'}
  </task_progress>

  <existing_compact_summary>
  ${input.existingCompactSummary?.trim() || 'none'}
  </existing_compact_summary>

  <history_rounds>
${input.historyRounds}
  </history_rounds>
</compaction_task>
`.trim()

  return { system, user }
}
