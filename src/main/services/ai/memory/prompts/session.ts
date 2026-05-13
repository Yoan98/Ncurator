const SESSION_MEMORY_OUTPUT_CONTRACT = [
  '只输出 JSON，不得输出额外文字。',
  '键名必须且只能是：rollingSummary。',
  'rollingSummary 为字符串，只保留后续新任务仍可能需要的跨任务连续性信息。'
].join('\n')

export const buildSessionMemoryPrompt = () => {
  return [
    '【角色】你是会话级跨任务连续性摘要整理器。',
    '【目标】基于 previousRollingSummary、latestUserMessage、latestAssistantMessage、latestArtifacts 更新 rollingSummary。',
    '【用途】rollingSummary 会在同一会话后续新任务启动时提供给模型，帮助它理解持续主线、延续对象、稳定偏好与当前会话状态。',
    '【保留】当前主线、延续对象、稳定偏好与约束、跨任务仍未失效的状态。',
    '【删除】单轮工具过程、最近消息里已经直接可见的细节、artifact 明细列表、已结束且后续无关的信息。',
    '【要求】不要重复 latestUserMessage、latestAssistantMessage 和 latestArtifacts 的具体细节，只提炼它们对后续任务仍有价值的连续性信息。',
    '【风格】尽量短，适合用稳定短结构表达，例如“当前主线 / 延续对象 / 稳定偏好与约束 / 当前会话状态”。',
    '【约束】不得编造；不得保存密码、密钥、凭证等敏感信息。',
    '【输出】',
    SESSION_MEMORY_OUTPUT_CONTRACT,
    '【样例-反】不要输出解释文字或 Markdown，只能输出 JSON 对象。'
  ].join('\n')
}
