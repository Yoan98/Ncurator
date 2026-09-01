import { AIMessage, type BaseMessage } from '@langchain/core/messages'

const isProcessMessage = (message: BaseMessage): boolean => {
  const type = message.getType()
  return type === 'ai' || type === 'tool'
}

// 压缩只针对过程历史（AI 消息 + 工具结果），固定模板（system / brain user）不进压缩。
// 压缩后保留最后一条 AI 消息及其后的工具结果作为 tail，重建时重新生成 system 与 brain user。
export const splitMessagesByLastAi = (
  messages: BaseMessage[]
): { compressible: BaseMessage[]; tail: BaseMessage[] } => {
  let lastAiIndex = -1
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index].getType() === 'ai') {
      lastAiIndex = index
    }
  }
  if (lastAiIndex < 0) {
    return { compressible: [], tail: [] }
  }
  return {
    compressible: messages.slice(0, lastAiIndex).filter(isProcessMessage),
    tail: messages.slice(lastAiIndex)
  }
}

const MAX_TOOL_CALL_ARG_LENGTH = 300

const formatToolCallArgValue = (value: unknown): string => {
  const rendered =
    typeof value === 'string' || (typeof value === 'object' && value !== null)
      ? JSON.stringify(value)
      : String(value)
  return rendered.length > MAX_TOOL_CALL_ARG_LENGTH
    ? `${rendered.slice(0, MAX_TOOL_CALL_ARG_LENGTH)}…`
    : rendered
}

const formatToolCallArgs = (args: Record<string, unknown>): string =>
  Object.entries(args)
    .map(([key, value]) => `${key}=${formatToolCallArgValue(value)}`)
    .join(', ')

const renderMessageForCompaction = (message: BaseMessage): string => {
  const role = message.getType()
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  if (role === 'ai') {
    const lines: string[] = []
    if (content.trim()) {
      lines.push(`[ai] ${content}`)
    }
    const toolCalls = (message as AIMessage).tool_calls
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        const name = typeof call?.name === 'string' && call.name ? call.name : 'unknown'
        const args = (call?.args ?? {}) as Record<string, unknown>
        lines.push(`[tool_call] ${name}(${formatToolCallArgs(args)})`)
      }
    }
    return lines.join('\n')
  }
  if (role === 'tool') {
    return `[tool] ${content}`
  }
  return ''
}

export const renderMessagesForCompaction = (messages: BaseMessage[]): string =>
  messages
    .map(renderMessageForCompaction)
    .filter((line) => line.length > 0)
    .join('\n\n')
