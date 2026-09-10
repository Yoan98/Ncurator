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

export const CONTEXT_SCOPE_SYSTEM_PROMPT = `你是上下文范围判定助手。判断这一轮是否需要紧邻的、上一轮刚做完的那段对话历史。

不要继续对话。不要回答用户的问题。不要输出 markdown 围栏、解释或任何其它文字。

只输出一个 JSON 对象，且只能是下面两种之一：
{"needsHistory":true}
{"needsHistory":false}

代价不对称：
- 误判为需要历史：只是多花 token。
- 误判为不需要历史：模型会失忆，无法继续刚做完的工作。
不确定时必须输出 {"needsHistory":true}。

目录只是已完成任务的线索，里面有上一轮摘要并不等于本轮可以丢掉历史。

{"needsHistory":true}：本轮仍在做最新一条目录对应的那件事（改、续、缩短、补充、纠正刚刚的交付）。
{"needsHistory":false}：换题；或点名的对象属于更早的目录条目。即使话里有「刚才」，只要指的不是最新那条，也是 false。`

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
    '判断这一轮是否需要紧邻的、上一轮刚做完的那段对话历史。',
    '{"needsHistory":true}：续做上一轮，把当前历史原文带给主模型。',
    '{"needsHistory":false}：换题或重开更早的旧任务，只带任务目录和新消息。',
    '只输出 JSON。'
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
