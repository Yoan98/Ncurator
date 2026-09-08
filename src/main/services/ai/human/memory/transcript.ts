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
  learnedSkillIds: string[]
  compactionCheckpoint?: {
    compactBlockId: string
    coveredThroughSeq: number
    sourceMessageCount: number
    createdAt: number
  }
}

export const orderMessageLogBySeq = (
  records: ChatMessageLogRecord[]
): ChatMessageLogRecord[] => [...records].sort((a, b) => a.seq - b.seq)

export const resolveCompactionCoveredThroughSeq = (
  records: ChatMessageLogRecord[],
  keepTailVisibleCount = 0
): number | undefined => {
  const ordered = orderMessageLogBySeq(records)
  const visible = ordered.filter(
    (record) =>
      record.entry.kind === 'user' ||
      record.entry.kind === 'assistant' ||
      record.entry.kind === 'tool'
  )
  if (visible.length === 0) return undefined
  const keepCount = Math.min(Math.max(0, keepTailVisibleCount), visible.length)
  if (keepCount === 0) {
    return visible.at(-1)?.seq
  }
  const firstKept = visible[visible.length - keepCount]
  if (!firstKept) return visible.at(-1)?.seq
  return [...ordered].reverse().find((record) => record.seq < firstKept.seq)?.seq
}

export const orderProjectedRecordsForBrain = (
  records: ChatMessageLogRecord[]
): ChatMessageLogRecord[] => {
  const compactionUsers: ChatMessageLogRecord[] = []
  const rest: ChatMessageLogRecord[] = []
  for (const record of records) {
    if (record.entry.kind === 'user' && record.entry.origin === 'compaction') {
      compactionUsers.push(record)
      continue
    }
    rest.push(record)
  }
  if (compactionUsers.length === 0) return records
  return [...compactionUsers, ...rest]
}

/**
 * 把不可变日志投影为下一次模型调用需要的历史。
 * `compaction_checkpoint.coveredThroughSeq` 覆盖范围内的对话由 compaction user 替代，绝不同时发送摘要和完整旧历史。
 */
export const projectMessageLogRecords = (
  records: ChatMessageLogRecord[]
): MessageLogProjection => {
  const ordered = orderMessageLogBySeq(records)
  const compactionCheckpointRecord = [...ordered]
    .reverse()
    .find(
      (record) =>
        record.entry.kind === 'annotation' &&
        record.entry.eventType === 'compaction_checkpoint'
    )
  const compactionCheckpoint =
    compactionCheckpointRecord?.entry.kind === 'annotation' &&
    compactionCheckpointRecord.entry.eventType === 'compaction_checkpoint'
      ? {
          ...compactionCheckpointRecord.entry.payload,
          createdAt: compactionCheckpointRecord.createdAt
        }
      : undefined

  const projectedRecords = compactionCheckpoint
    ? ordered.filter((record) => record.seq > compactionCheckpoint.coveredThroughSeq)
    : ordered
  // 历史 user 由 projectBrainMessagesFromLog 按 content 还原；这里只投影过程 tail。
  // 每次新 run 的当前 user 统一由 buildBrainUserMessage 构造。
  const messages = deriveMessageLogMessages({
    entries: projectedRecords
      .map((record) => record.entry)
      .filter((entry) => entry.kind !== 'user')
  })
  let plan: ChatMessageLogPlanItem[] = []
  let learnedSkillIds: string[] = []
  for (const record of ordered) {
    const entry = record.entry
    if (entry.kind === 'annotation' && entry.eventType === 'plan_updated') {
      plan = entry.payload.plan.map((item) => ({ ...item }))
    } else if (entry.kind === 'annotation' && entry.eventType === 'finalizing_started') {
      plan = []
    } else if (entry.kind === 'annotation' && entry.eventType === 'skill_state_updated') {
      learnedSkillIds = [...entry.payload.learnedSkillIds]
    }
  }

  return {
    messages: repairInterruptedToolCalls(messages),
    plan,
    learnedSkillIds,
    compactionCheckpoint
  }
}
