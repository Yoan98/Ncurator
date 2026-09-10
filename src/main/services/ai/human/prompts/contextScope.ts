export const wrapTaskCatalogContent = (catalogText: string): string => {
  const body = catalogText.trim()
  if (!body) return ''
  return [
    'The following catalog lists recently completed tasks in this partner. It is not the current conversation.',
    'If you need details from one of these tasks, read the listed file paths with tools rather than assuming prior dialogue.',
    '',
    '<task_catalog>',
    body,
    '</task_catalog>'
  ].join('\n')
}

export const CONTEXT_SCOPE_SYSTEM_PROMPT = `你是上下文范围判定助手。判断这一轮是否需要紧邻的、正在进行的那段对话历史。

不要继续对话。不要回答用户的问题。只输出结构化判定。

代价不对称：
- 误判为需要历史：只是多花 token。
- 误判为不需要历史：模型会失忆，无法继续刚做完的工作。
不确定时必须判定为需要历史。

用户提到某个已完成的旧任务时，判定为不需要历史：那是开启一段关于旧对象的新工作，当前对话历史对它是噪音；主模型会从目录拿到文件路径去读当前内容。`

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
    '</new_task_goal>',
    '',
    '判断这一轮是否需要紧邻的、正在进行的那段对话历史。',
    'needsHistory=true 表示需要把当前历史原文带给主模型。',
    'needsHistory=false 表示只带任务目录和新消息。'
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
