import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatMessageImageRef,
  ChatMessageLogEntry,
  ChatMessageLogPlanItem,
  ChatMessageLogRecord,
  ChatMessageLogToolCall
} from '../../../../../shared/types'
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

const INTERRUPTED_TOOL_CONTENT =
  'Error: The run was interrupted before this tool call could be executed.'

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
  let pendingImages: ChatMessageImageRef[] = []
  const flushImages = (): void => {
    if (pendingImages.length === 0) return
    messages.push(createImageReferenceMessage(pendingImages))
    pendingImages = []
  }
  for (let index = 0; index < input.entries.length; index += 1) {
    const entry = input.entries[index]
    if (input.skipLastUserEntry && entry.kind === 'user' && index === lastUserIndex) {
      continue
    }
    if (entry.kind === 'user') {
      flushImages()
      messages.push(new HumanMessage(entry.content))
      continue
    }
    if (entry.kind === 'assistant') {
      flushImages()
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
          content: entry.content,
          tool_call_id: entry.toolCallId
        })
      )
      if (entry.images?.length) pendingImages.push(...entry.images)
      continue
    }
  }
  flushImages()
  return messages
}

export type MessageLogProjection = {
  messages: BaseMessage[]
  plan: ChatMessageLogPlanItem[]
  checkpoint?: {
    compactBlockId: string
    summary: string
    coveredThroughSeq: number
    sourceMessageCount: number
    createdAt: number
  }
}

/**
 * 把不可变日志投影为下一次模型调用需要的历史。
 * checkpoint 之前的对话由一条摘要替代，绝不同时发送摘要和完整旧历史。
 */
export const projectMessageLogRecords = (
  records: ChatMessageLogRecord[]
): MessageLogProjection => {
  const ordered = [...records].sort((a, b) => a.seq - b.seq)
  const checkpointRecord = [...ordered]
    .reverse()
    .find(
      (record) =>
        record.entry.kind === 'annotation' &&
        record.entry.eventType === 'compaction_checkpoint'
    )
  const checkpoint =
    checkpointRecord?.entry.kind === 'annotation' &&
    checkpointRecord.entry.eventType === 'compaction_checkpoint'
      ? {
          ...checkpointRecord.entry.payload,
          createdAt: checkpointRecord.createdAt
        }
      : undefined

  const projectedRecords = checkpoint
    ? ordered.filter((record) => record.seq > checkpoint.coveredThroughSeq)
    : ordered
  const messages = deriveMessageLogMessages({
    entries: projectedRecords.map((record) => record.entry)
  })
  let plan: ChatMessageLogPlanItem[] = []
  for (const record of ordered) {
    const entry = record.entry
    if (entry.kind === 'annotation' && entry.eventType === 'plan_updated') {
      plan = entry.payload.plan.map((item) => ({ ...item }))
    } else if (entry.kind === 'annotation' && entry.eventType === 'finalizing_started') {
      plan = []
    }
  }

  return {
    messages: repairInterruptedToolCalls(messages),
    plan,
    checkpoint
  }
}
