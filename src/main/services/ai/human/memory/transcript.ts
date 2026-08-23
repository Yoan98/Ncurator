import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, ChatMessageLogToolCall } from '../../../../../shared/types'

const toToolCall = (call: ChatMessageLogToolCall): {
  id: string
  name: string
  args: Record<string, unknown>
  type: 'tool_call'
} => ({
  id: call.id,
  name: call.name,
  args: call.args as unknown as Record<string, unknown>,
  type: 'tool_call'
})

export const deriveMessageLogMessages = (input: {
  entries: ChatMessageLogEntry[]
  skipUserContent?: string
}): BaseMessage[] => {
  const messages: BaseMessage[] = []
  for (const entry of input.entries) {
    if (entry.kind === 'user') {
      if (input.skipUserContent && entry.content === input.skipUserContent) continue
      messages.push(new HumanMessage(entry.content))
      continue
    }
    if (entry.kind === 'assistant') {
      messages.push(
        new AIMessage({
          content: entry.content,
          tool_calls: entry.toolCalls.map(toToolCall)
        })
      )
      continue
    }
    if (entry.kind === 'tool') {
      messages.push(
        new ToolMessage({
          content: entry.result === undefined ? '{}' : JSON.stringify(entry.result),
          tool_call_id: entry.toolCallId
        })
      )
      continue
    }
  }
  return messages
}
