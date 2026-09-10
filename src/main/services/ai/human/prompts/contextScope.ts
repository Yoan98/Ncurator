export const wrapDiscardConversationHistory = (historyText: string): string => {
  const body = historyText.trim()
  if (!body) return ''
  return ['以下是最近的会话内容', '', body].join('\n')
}

export const CONTEXT_SCOPE_SYSTEM_PROMPT = `你是上下文范围判定助手。根据近期任务目录和新诉求，判断这一轮还需不需要当前这段对话历史原文。

needsHistory=true：新诉求在延续、追问、修改或纠正目录里近期任何一件事。
needsHistory=false：新诉求是全新话题，和目录里的事都无关。
判断不了就按 true：多带历史只多花 token，少带历史会让模型失忆。

不要继续对话，不要回答用户的问题。只输出 JSON，形如 {"needsHistory": true}。`

export const buildContextScopeDecisionPrompt = (input: {
  catalogText: string
  taskGoal: string
}): { system: string; user: string } => ({
  system: CONTEXT_SCOPE_SYSTEM_PROMPT,
  user: [
    '<completed_task_catalog>',
    input.catalogText.trim() || '无',
    '</completed_task_catalog>',
    '',
    '<new_task_goal>',
    input.taskGoal.trim() || '无',
    '</new_task_goal>'
  ].join('\n')
})

export const RUN_DIGEST_SYSTEM_PROMPT = `你是任务摘要助手。把这一轮用户诉求和最终交付压成一句 20 到 40 字的中文摘要，供后续判断是否需要这段历史。

不要继续对话。不要复述全文。只输出这一句话。保留关键对象、文件名或结论。禁止编造不存在事项`

export const buildRunDigestPrompt = (input: {
  userInput: string
  deliveryMarkdown: string
}): { system: string; user: string } => ({
  system: RUN_DIGEST_SYSTEM_PROMPT,
  user: [
    '<user_input>',
    input.userInput.trim() || '无',
    '</user_input>',
    '',
    '<delivery>',
    input.deliveryMarkdown.trim() || '无',
    '</delivery>',
    '',
    '用一句话概括这一轮完成了什么。'
  ].join('\n')
})
