export const wrapDiscardConversationHistory = (historyText: string): string => {
  const body = historyText.trim()
  if (!body) return ''
  return `以下是最近的会话内容

${body}`
}

export const CONTEXT_SCOPE_SYSTEM_PROMPT = `你是上下文范围判定助手。根据近期已完成任务的 digest 和新诉求，判断这一轮还需不需要当前这段对话历史原文。

needsHistory=true：新诉求在延续、追问、修改或纠正这些 digest 里近期任何一件事。
needsHistory=false：新诉求是全新话题，和这些 digest 里的事都无关。

不要继续对话，不要回答用户的问题。只输出 JSON，形如 {"needsHistory": true, "reason": "一句话原因"}。`

export const buildContextScopeDecisionPrompt = (input: {
  digestText: string
  taskGoal: string
}): { system: string; user: string } => ({
  system: CONTEXT_SCOPE_SYSTEM_PROMPT,
  user: `近期任务：
${input.digestText.trim() || '无'}

新诉求：
${input.taskGoal.trim() || '无'}`
})

export const RUN_DIGEST_SYSTEM_PROMPT = `你是任务摘要助手。把这一轮用户诉求和最终交付压成一句 20 到 40 字的中文摘要，供后续判断是否需要这段历史。

不要继续对话。不要复述全文。只输出这一句话。保留关键对象、文件名或结论。禁止编造不存在事项`

export const buildRunDigestPrompt = (input: {
  userInput: string
  deliveryMarkdown: string
  compactReferences?: string
}): { system: string; user: string } => {
  const compactReferences = input.compactReferences?.trim()
  return {
    system: RUN_DIGEST_SYSTEM_PROMPT,
    user: [
      `用户：${input.userInput.trim() || '无'}`,
      compactReferences ? `参考：${compactReferences}` : '',
      `交付：${input.deliveryMarkdown.trim() || '无'}`
    ]
      .filter((line) => line.length > 0)
      .join('\n')
  }
}
