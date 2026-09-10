import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatMessageImageRef,
  ChatMessageLogEntry,
  ChatMessageLogToolCall
} from '../../../../../shared/types'
import type { HumanRuntimeCache } from '../types'
import { createImageReferenceMessage } from './multimodal'

const toToolCall = (
  call: ChatMessageLogToolCall
): {
  id: string
  name: string
  args: Record<string, unknown>
  type: 'tool_call'
} => ({
  id: call.id,
  name: call.name,
  args: { ...call.args },
  type: 'tool_call'
})

const createUserMessage = (content: string): HumanMessage => new HumanMessage(content)

const createAssistantMessage = (entry: Extract<ChatMessageLogEntry, { kind: 'assistant' }>): AIMessage =>
  new AIMessage({
    content: entry.content,
    tool_calls: entry.toolCalls.map(toToolCall)
  })

const createToolMessage = (entry: Extract<ChatMessageLogEntry, { kind: 'tool' }>): ToolMessage =>
  new ToolMessage({
    content: entry.content,
    tool_call_id: entry.toolCallId
  })

/**
 * 把 conversation log 转成 brain 请求里的 LangChain 消息。
 * 同 run append 和新 run 投影必须走这里，避免各自 `new AIMessage` / `new ToolMessage`。
 * annotation 不进请求；合成 System / checkpoint User / 目录 User / 当前 build User 不走这条。
 */
export const messagesFromLogEntries = (entries: ChatMessageLogEntry[]): BaseMessage[] => {
  const messages: BaseMessage[] = []
  const pendingImages: ChatMessageImageRef[] = []
  const flushImages = (): void => {
    if (pendingImages.length === 0) return
    messages.push(createImageReferenceMessage(pendingImages))
    pendingImages.length = 0
  }

  for (const entry of entries) {
    if (entry.kind === 'user') {
      flushImages()
      messages.push(createUserMessage(entry.content))
      continue
    }
    if (entry.kind === 'assistant') {
      flushImages()
      messages.push(createAssistantMessage(entry))
      continue
    }
    if (entry.kind === 'tool') {
      messages.push(createToolMessage(entry))
      if (entry.images?.length) pendingImages.push(...entry.images)
    }
  }
  flushImages()
  return messages
}

export const appendLogEntriesToCache = (
  cache: HumanRuntimeCache,
  entries: ChatMessageLogEntry[]
): void => {
  const messages = cache.messages || []
  messages.push(...messagesFromLogEntries(entries))
  cache.messages = messages
}
