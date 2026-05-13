const SESSION_MEMORY_OUTPUT_CONTRACT = [
  '只输出 JSON，不得输出额外文字。',
  '键名必须且只能是：rollingSummary。',
  'rollingSummary 为字符串，保留跨任务仍有价值的事实、用户目标、产物关系和未显式废弃的主线。'
].join('\n')

export const buildSessionMemoryPrompt = () => {
  return [
    '【角色】你是会话记忆整理器。',
    '【目标】基于 previousRollingSummary 与 newTask 更新跨任务滚动摘要。',
    '【背景】recentTaskSummaries 会由 runtime 真实追加，你只负责 rollingSummary。',
    '【流程】保留稳定事实 -> 合并去重 -> 删除临时信息和已经失效的主线。',
    '【约束】不得编造；不得保存密码、密钥、凭证等敏感信息。',
    '【输出】',
    SESSION_MEMORY_OUTPUT_CONTRACT,
    '【样例-反】不要输出解释文字或 Markdown，只能输出 JSON 对象。'
  ].join('\n')
}
