import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogPlanItem,
  ChatMessageLogRecord
} from '../../../../../shared/types'
import { messagesFromLogEntries } from './conversationLogMessages'

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
  const entries =
    lastUserIndex >= 0
      ? input.entries.filter(
          (entry, index) => !(entry.kind === 'user' && index === lastUserIndex)
        )
      : input.entries
  return messagesFromLogEntries(entries)
}

export type MessageLogProjection = {
  messages: BaseMessage[]
  plan: ChatMessageLogPlanItem[]
  learnedSkillIds: string[]
  compactionCheckpoint?: {
    compactBlockId: string
    throughSeq: number
    sourceMessageCount: number
    summary: string
    createdAt: number
  }
  discardCheckpoint?: {
    throughSeq: number
    conversationHistory: string
  }
  historyFloorSeq: number
}

export const orderMessageLogBySeq = (
  records: ChatMessageLogRecord[]
): ChatMessageLogRecord[] => [...records].sort((a, b) => a.seq - b.seq)

export const isConversationLogRecord = (record: ChatMessageLogRecord): boolean =>
  record.entry.kind === 'user' ||
  record.entry.kind === 'assistant' ||
  record.entry.kind === 'tool'

export type HistoryFloor = {
  historyFloorSeq: number
  compactionCheckpoint?: MessageLogProjection['compactionCheckpoint']
  discardCheckpoint?: MessageLogProjection['discardCheckpoint']
  includeCheckpoint: boolean
  includeDiscard: boolean
}

export const resolveHistoryFloor = (records: readonly ChatMessageLogRecord[]): HistoryFloor => {
  const ordered = orderMessageLogBySeq([...records])
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
  const discardRecord = [...ordered]
    .reverse()
    .find((record) => {
      if (
        record.entry.kind !== 'annotation' ||
        record.entry.eventType !== 'discard_checkpoint'
      ) {
        return false
      }
      return ordered.some(
        (candidate) => candidate.runId === record.runId && isConversationLogRecord(candidate)
      )
    })
  const discardCheckpoint =
    discardRecord?.entry.kind === 'annotation' &&
    discardRecord.entry.eventType === 'discard_checkpoint'
      ? {
          throughSeq: discardRecord.entry.payload.throughSeq,
          conversationHistory: discardRecord.entry.payload.conversationHistory
        }
      : undefined
  const historyFloorSeq = Math.max(
    compactionCheckpoint?.throughSeq ?? -1,
    discardCheckpoint?.throughSeq ?? -1
  )
  const includeCheckpoint = Boolean(
    compactionCheckpoint &&
      compactionCheckpoint.throughSeq >= (discardCheckpoint?.throughSeq ?? -1)
  )
  const includeDiscard = Boolean(
    discardCheckpoint && discardCheckpoint.throughSeq > (compactionCheckpoint?.throughSeq ?? -1)
  )
  return {
    historyFloorSeq,
    compactionCheckpoint: includeCheckpoint ? compactionCheckpoint : undefined,
    discardCheckpoint: includeDiscard ? discardCheckpoint : undefined,
    includeCheckpoint,
    includeDiscard
  }
}

export const resolveLastConversationRunId = (
  records: readonly ChatMessageLogRecord[]
): string | undefined =>
  [...orderMessageLogBySeq([...records])].reverse().find(isConversationLogRecord)?.runId

export const runHasDelivery = (
  records: readonly ChatMessageLogRecord[],
  runId: string
): boolean =>
  records.some(
    (record) =>
      record.runId === runId &&
      record.entry.kind === 'assistant' &&
      record.entry.toolCalls.length === 0
  )

export const runHasCompletedDigest = (
  records: readonly ChatMessageLogRecord[],
  runId: string
): boolean =>
  records.some((record) => {
    if (
      record.runId !== runId ||
      record.entry.kind !== 'annotation' ||
      record.entry.eventType !== 'run_digest'
    ) {
      return false
    }
    const { status, summary } = record.entry.payload
    if (status === 'completed') return true
    return !status && Boolean(summary.trim())
  })

export const runHasDigest = runHasCompletedDigest

export const resolveMaxMessageLogSeq = (records: readonly ChatMessageLogRecord[]): number =>
  records.reduce((maxSeq, record) => Math.max(maxSeq, record.seq), -1)

export const resolveCompactionThroughSeq = (
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

/**
 * 把不可变日志投影为下一次模型调用需要的历史。
 * `compaction_checkpoint.throughSeq` 覆盖范围内的对话由 checkpoint 摘要替代，绝不同时发送摘要和完整旧历史。
 */
export const projectMessageLogRecords = (
  records: ChatMessageLogRecord[]
): MessageLogProjection => {
  const ordered = orderMessageLogBySeq(records)
  const floor = resolveHistoryFloor(ordered)
  const projectedRecords = ordered.filter((record) => record.seq > floor.historyFloorSeq)
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
    compactionCheckpoint: floor.compactionCheckpoint,
    discardCheckpoint: floor.discardCheckpoint,
    historyFloorSeq: floor.historyFloorSeq
  }
}
