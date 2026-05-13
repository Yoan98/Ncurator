const SESSION_MEMORY_OUTPUT_CONTRACT = [
  '- 只输出 JSON，不得输出额外文字。',
  '- 键名必须且只能是：rollingSummary。',
  '- rollingSummary 为字符串，只保留后续新任务仍可能需要的跨任务连续性信息。'
].join('\n')

export const buildSessionMemoryPrompt = () => {
  return `
<system>
  <role>
    你是会话级跨任务连续性摘要整理器。
  </role>

  <goal>
    基于 previousRollingSummary、latestUserMessage、latestAssistantMessage、latestArtifacts 更新 rollingSummary。
  </goal>

  <memory_contract>
    - rollingSummary 会在同一会话后续新任务启动时提供给模型，帮助它理解持续主线、延续对象、稳定偏好与当前会话状态。
    - 保留当前主线、延续对象、稳定偏好与约束、跨任务仍未失效的状态。
    - 删除单轮工具过程、最近消息里已经直接可见的细节、artifact 明细列表、已结束且后续无关的信息。
    - 不要重复 latestUserMessage、latestAssistantMessage 和 latestArtifacts 的具体细节，只提炼它们对后续任务仍有价值的连续性信息。
    - 尽量短，适合用稳定短结构表达，例如“当前主线 / 延续对象 / 稳定偏好与约束 / 当前会话状态”。
    - 不得编造；不得保存密码、密钥、凭证等敏感信息。
  </memory_contract>

  <input_guide>
    - previousRollingSummary：本次更新前已有的跨任务滚动摘要。
    - latestUserMessage：刚完成任务对应的用户消息。
    - latestAssistantMessage：刚完成任务的最终交付。
    - latestArtifacts：刚完成任务产生的 artifacts；只提炼后续任务仍需要知道的连续性信息。
  </input_guide>

  <output_contract>
${SESSION_MEMORY_OUTPUT_CONTRACT}
  </output_contract>
</system>
`.trim()
}
