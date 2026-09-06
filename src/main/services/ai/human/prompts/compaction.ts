export const buildHistoryCompactionPrompt = (input: {
  currentText: string
  earlierText: string
}) => {
  const system = `
<system>
<role>
你是上下文压缩器。根据 current 写当前工作记忆，根据 earlier 写历史事实时间线。
</role>

<principles>
- 当前工作记忆要让这件事还能接着做：刚发生的 AI/工具结果必须写进「当前交付」或「已确认事实」。
- 必须保留：路径、文件名、标题、id、结构；还要遵守的限制；未完成点；再试会空转的失败（一句结论）。
- 必须丢掉：工具入参、检索噪声、Thought、重复试错过程、当前用户诉求原文。
- 历史事实按时间从旧到新；越早的事越短，越近的事可以更具体。
- 整份重写，不要把上一份记忆原文粘贴进输出。
- 禁止编造；路径、文件名、标题、id 复用原文。
</principles>

<context_block_guide>
- current：现在这句用户消息 + 它之后的过程（含最后一步）。只用来写当前交付、已确认事实、已尝试但未解决。
- earlier：这句用户消息之前的对话，可空。只用来写历史事实。
- 用户消息还会再发给主模型，不要复述其诉求。其中若已有记忆段落，只作对照，不要整段粘贴。
</context_block_guide>

<output_contract>
纯文本，不要 JSON，不要解释。严格使用：

当前交付：
- ...
已确认事实：
- ...
已尝试但未解决：
- ...
历史事实：
- {时间} {做过什么} → {结果或路径}

空栏目写「- 无」。
</output_contract>
</system>
`.trim()

  const user = `
<memory_task>
  <current>
${input.currentText.trim() || '无'}
  </current>

  <earlier>
${input.earlierText.trim() || '无'}
  </earlier>
</memory_task>
`.trim()

  return { system, user }
}
