export const wrapCompactionCheckpointContent = (summary: string): string => {
  const body = summary.trim() || '无'
  return [
    'The conversation history before this point was compacted into the following summary:',
    '',
    '<summary>',
    body,
    '</summary>'
  ].join('\n')
}

export const COMPACTION_SYSTEM_PROMPT = `你是上下文摘要助手。阅读用户与 AI 助手之间的对话，按指定格式输出结构化摘要。

不要继续对话。不要回答对话里的任何问题。只输出结构化摘要。`

const historyUserPrompt = (conversationText: string) => `<conversation>
${conversationText.trim() || '无'}
</conversation>

以上消息是需要摘要的对话。请写成一份结构化的上下文检查点摘要，供后续模型继续工作。

严格使用以下格式：

## 目标
[用户想完成什么。一次会话里有多件事就并列。]

## 约束与偏好
- [用户提到的约束、偏好或要求]
- [若没有则写「无」]

## 进度
### 已完成
- [x] [已完成的任务/改动]

### 进行中
- [ ] [当前工作]

### 阻塞
- [阻碍进度的问题，如有]

## 关键决策
- **[决策]**：[简要理由]

## 下一步
1. [接下来该做什么，有序列表]

## 关键上下文
- [继续工作所需的数据、例子或引用]
- [若不适用则写「无」]

各栏保持简短。保留精确的文件路径、函数名和报错原文。`

const turnPrefixUserPrompt = (conversationText: string) => `<conversation>
${conversationText.trim() || '无'}
</conversation>

这是一轮中因过长而无法整轮保留的前缀。该轮后缀（近期工作）仍会保留。

请摘要此前缀，以便理解被留下的后缀：

## 原始请求
[用户在这一轮要求什么？]

## 前期进展
- [此前缀中的关键决策和已完成工作]

## 后缀所需上下文
- [理解被留下的近期工作所需要的信息]

保持简短。聚焦于理解留下的后缀所必需的内容。`

export const buildHistoryCompactionPrompt = (input: {
  conversationText: string
}): { system: string; user: string } => ({
  system: COMPACTION_SYSTEM_PROMPT,
  user: historyUserPrompt(input.conversationText)
})

export const buildTurnPrefixCompactionPrompt = (input: {
  conversationText: string
}): { system: string; user: string } => ({
  system: COMPACTION_SYSTEM_PROMPT,
  user: turnPrefixUserPrompt(input.conversationText)
})

export const joinSplitCompactionSummary = (
  historySummary: string,
  turnPrefixSummary: string
): string =>
  `${historySummary.trim() || '无更早历史'}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixSummary.trim() || '无'}`
