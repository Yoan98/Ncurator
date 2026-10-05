import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, ChatMessageLogToolCall } from '../../../../../shared/types'
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

const createAssistantMessage = (
  entry: Extract<ChatMessageLogEntry, { kind: 'assistant' }>
): AIMessage =>
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
 * annotation 不进请求；合成 System / Compact User / 当前 build User 不走这条。
 */
type ProjectionState = NonNullable<HumanRuntimeCache['conversationProjection']>

const createProjectionState = (): ProjectionState => ({
  pendingToolCallIds: new Set(),
  pendingImages: []
})

const appendProjectedEntries = (
  messages: BaseMessage[],
  entries: ChatMessageLogEntry[],
  state: ProjectionState
): void => {
  const flushImages = (): void => {
    if (state.pendingImages.length === 0) return
    messages.push(createImageReferenceMessage(state.pendingImages))
    state.pendingImages.length = 0
  }

  for (const entry of entries) {
    if (entry.kind === 'user') {
      flushImages()
      state.pendingToolCallIds.clear()
      messages.push(createUserMessage(entry.content))
      continue
    }
    if (entry.kind === 'assistant') {
      flushImages()
      state.pendingToolCallIds = new Set(entry.toolCalls.map((call) => call.id))
      messages.push(createAssistantMessage(entry))
      continue
    }
    if (entry.kind === 'tool') {
      messages.push(createToolMessage(entry))
      if (entry.images?.length) state.pendingImages.push(...entry.images)
      state.pendingToolCallIds.delete(entry.toolCallId)
      if (state.pendingToolCallIds.size === 0) flushImages()
    }
  }
}

export const messagesFromLogEntries = (entries: ChatMessageLogEntry[]): BaseMessage[] => {
  const messages: BaseMessage[] = []
  const state = createProjectionState()
  appendProjectedEntries(messages, entries, state)
  // Interrupted batches keep their images; transcript repair inserts missing
  // tool results before this image message when rebuilding for the next run.
  if (state.pendingImages.length) messages.push(createImageReferenceMessage(state.pendingImages))
  return messages
}

export const appendLogEntriesToCache = (
  cache: HumanRuntimeCache,
  entries: ChatMessageLogEntry[]
): void => {
  const messages = cache.messages || []
  const state = (cache.conversationProjection ??= createProjectionState())
  appendProjectedEntries(messages, entries, state)
  cache.messages = messages
}
