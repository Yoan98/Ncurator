import type { SubagentTask } from '../../types'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogPlanItem,
  ChatMessageLogRecord
} from '../../../../../shared/types'
import { messagesFromLogEntries } from './conversationLogMessages'

const INTERRUPTED_TOOL_CONTENT =
  'Error: The run was interrupted before this tool call could be executed.'

export const repairInterruptedToolCalls = (
  messages: BaseMessage[],
  records: readonly ChatMessageLogRecord[] = []
): BaseMessage[] => {
  const childResults = new Map<
    string,
    Map<string, import('../../../../../shared/types').SubagentUpdate>
  >()
  for (const record of records) {
    if (record.entry.kind !== 'annotation' || record.entry.eventType !== 'subagent_updated')
      continue
    const update = record.entry.payload
    const children = childResults.get(update.toolCallId) || new Map()
    children.set(update.childRunId, update)
    childResults.set(update.toolCallId, children)
  }
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
        const remainingChildren = [...(childResults.get(id)?.values() || [])]
        pendingInterrupted.push(
          new ToolMessage({
            content:
              call.name === 'delegate_to_subagent'
                ? JSON.stringify({
                    children: Array.isArray(call.args?.tasks)
                      ? call.args.tasks.map((task: SubagentTask) => {
                          const childIndex = remainingChildren.findIndex((child) =>
                            task.agentId
                              ? child.agentId === task.agentId
                              : child.name === task.name && child.task === task.task
                          )
                          const completed =
                            childIndex >= 0 ? remainingChildren.splice(childIndex, 1)[0] : undefined
                          return completed &&
                            completed.status !== 'running' &&
                            completed.status !== 'queued' &&
                            completed.status !== 'waiting_approval'
                            ? completed
                            : {
                                ...(completed || task),
                                status: 'interrupted',
                                result: '执行被中断，未收到完整结果'
                              }
                        })
                      : [],
                    interrupted: true
                  })
                : INTERRUPTED_TOOL_CONTENT,
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
      ? input.entries.filter((entry, index) => !(entry.kind === 'user' && index === lastUserIndex))
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
  historyFloorSeq: number
}

export const orderMessageLogBySeq = (records: ChatMessageLogRecord[]): ChatMessageLogRecord[] =>
  [...records].sort((a, b) => a.seq - b.seq)

export const isConversationLogRecord = (record: ChatMessageLogRecord): boolean =>
  record.entry.kind === 'user' || record.entry.kind === 'assistant' || record.entry.kind === 'tool'

export type HistoryFloor = {
  historyFloorSeq: number
  compactionCheckpoint?: MessageLogProjection['compactionCheckpoint']
}

export const resolveHistoryFloor = (records: readonly ChatMessageLogRecord[]): HistoryFloor => {
  const ordered = orderMessageLogBySeq([...records])
  const compactionCheckpointRecord = [...ordered]
    .reverse()
    .find(
      (record) =>
        record.entry.kind === 'annotation' && record.entry.eventType === 'compaction_checkpoint'
    )
  const compactionCheckpoint =
    compactionCheckpointRecord?.entry.kind === 'annotation' &&
    compactionCheckpointRecord.entry.eventType === 'compaction_checkpoint'
      ? {
          ...compactionCheckpointRecord.entry.payload,
          createdAt: compactionCheckpointRecord.createdAt
        }
      : undefined
  return {
    historyFloorSeq: compactionCheckpoint?.throughSeq ?? -1,
    compactionCheckpoint
  }
}

export const resolveMaxMessageLogSeq = (records: readonly ChatMessageLogRecord[]): number =>
  records.reduce((maxSeq, record) => Math.max(maxSeq, record.seq), -1)

export const resolveCompactionThroughSeq = (
  records: ChatMessageLogRecord[],
  firstKeptSeq?: number
): number | undefined => {
  const ordered = orderMessageLogBySeq(records)
  if (ordered.length === 0) return undefined
  if (firstKeptSeq === undefined) return ordered.at(-1)?.seq
  return [...ordered].reverse().find((record) => record.seq < firstKeptSeq)?.seq
}

/**
 * 把不可变日志投影为下一次模型调用需要的历史。
 * `compaction_checkpoint.throughSeq` 覆盖范围内的对话由 checkpoint 摘要替代，绝不同时发送摘要和完整旧历史。
 */
export const projectMessageLogRecords = (records: ChatMessageLogRecord[]): MessageLogProjection => {
  const ordered = orderMessageLogBySeq(records)
  const floor = resolveHistoryFloor(ordered)
  const projectedRecords = ordered.filter((record) => record.seq > floor.historyFloorSeq)
  // 历史 user 由 projectBrainMessagesFromLog 按 content 还原；这里只投影过程 tail。
  // 每次新 run 的当前 user 统一由 buildBrainUserMessage 构造。
  const messages = deriveMessageLogMessages({
    entries: projectedRecords.map((record) => record.entry).filter((entry) => entry.kind !== 'user')
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
    messages: repairInterruptedToolCalls(messages, ordered),
    plan,
    learnedSkillIds,
    compactionCheckpoint: floor.compactionCheckpoint,
    historyFloorSeq: floor.historyFloorSeq
  }
}
