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

const INTERRUPTED_TOOL_RESULT = {
  ok: false,
  code: 'interrupted',
  error: '运行意外中断，该工具调用未执行。'
} as const

const INTERRUPTED_TOOL_CONTENT = JSON.stringify(INTERRUPTED_TOOL_RESULT)

export const repairInterruptedToolCalls = (messages: BaseMessage[]): BaseMessage[] => {
  const satisfied = new Set<string>()
  for (const message of messages) {
    if (message.getType() !== 'tool') continue
    const id = (message as ToolMessage).tool_call_id
    if (typeof id === 'string' && id) satisfied.add(id)
  }

  const repaired: BaseMessage[] = []
  const pendingInterrupted: ToolMessage[] = []
  for (const message of messages) {
    const type = message.getType()
    if (type === 'ai') {
      repaired.push(...pendingInterrupted)
      pendingInterrupted.length = 0
      repaired.push(message)
      const calls = (message as AIMessage).tool_calls
      if (!Array.isArray(calls)) continue
      for (const call of calls) {
        const id = typeof call.id === 'string' ? call.id : ''
        if (!id || satisfied.has(id)) continue
        pendingInterrupted.push(
          new ToolMessage({
            content: INTERRUPTED_TOOL_CONTENT,
            tool_call_id: id
          })
        )
      }
      continue
    }
    if (type === 'tool') {
      repaired.push(message)
      continue
    }
    repaired.push(...pendingInterrupted)
    pendingInterrupted.length = 0
    repaired.push(message)
  }
  repaired.push(...pendingInterrupted)
  return repaired
}

export const deriveMessageLogMessages = (input: {
  entries: ChatMessageLogEntry[]
  skipLastUserEntry?: boolean
}): BaseMessage[] => {
  let lastUserIndex = -1
  if (input.skipLastUserEntry) {
    for (let index = 0; index < input.entries.length; index += 1) {
      if (input.entries[index].kind === 'user') lastUserIndex = index
    }
  }

  const messages: BaseMessage[] = []
  for (let index = 0; index < input.entries.length; index += 1) {
    const entry = input.entries[index]
    if (input.skipLastUserEntry && entry.kind === 'user' && index === lastUserIndex) {
      continue
    }
    if (entry.kind === 'user') {
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
