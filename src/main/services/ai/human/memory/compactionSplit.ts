import type { ChatMessageLogRecord } from '../../../../../shared/types'
import { estimateMessagesForContext } from './multimodal'
import { messagesFromLogEntries } from './conversationLogMessages'
import {
  isConversationLogRecord,
  orderMessageLogBySeq,
  resolveCompactionThroughSeq,
  resolveHistoryFloor
} from './transcript'

export type CompactionLogSplit = {
  folded: ChatMessageLogRecord[]
  tail: ChatMessageLogRecord[]
  history: ChatMessageLogRecord[]
  turnPrefix: ChatMessageLogRecord[]
  isSplitTurn: boolean
  firstKeptSeq?: number
  throughSeq?: number
}

const visibleConversationRecords = (records: ChatMessageLogRecord[]): ChatMessageLogRecord[] => {
  const ordered = orderMessageLogBySeq(records)
  const floor = resolveHistoryFloor(ordered)
  return ordered.filter(
    (record) => record.seq > floor.historyFloorSeq && isConversationLogRecord(record)
  )
}

const groupVisibleRecords = (records: ChatMessageLogRecord[]): ChatMessageLogRecord[][] => {
  const groups: ChatMessageLogRecord[][] = []
  let current: ChatMessageLogRecord[] = []
  const flush = (): void => {
    if (current.length === 0) return
    groups.push(current)
    current = []
  }
  for (const record of records) {
    const kind = record.entry.kind
    if (kind === 'user' || kind === 'assistant') {
      flush()
      current = [record]
      continue
    }
    if (current.length === 0) {
      current = [record]
      continue
    }
    current.push(record)
  }
  flush()
  return groups
}

const groupTokenCost = (group: ChatMessageLogRecord[]): number =>
  estimateMessagesForContext(messagesFromLogEntries(group.map((record) => record.entry)))

const keepGroupsFromEnd = (groups: ChatMessageLogRecord[][], retainTokens: number): number => {
  if (groups.length === 0) return 0
  let used = 0
  let firstKeptIndex = groups.length
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (!group) continue
    const cost = groupTokenCost(group)
    if (firstKeptIndex === groups.length || used + cost <= retainTokens) {
      firstKeptIndex = index
      used += cost
      continue
    }
    break
  }
  return firstKeptIndex
}

const findTurnStartGroupIndex = (
  groups: ChatMessageLogRecord[][],
  beforeIndex: number
): number => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (groups[index]?.[0]?.entry.kind === 'user') return index
  }
  return -1
}

export const splitLogForCompactionTail = (
  records: ChatMessageLogRecord[],
  retainTokens: number
): CompactionLogSplit => {
  const visible = visibleConversationRecords(records)
  const groups = groupVisibleRecords(visible)
  if (groups.length === 0) {
    return { folded: [], tail: [], history: [], turnPrefix: [], isSplitTurn: false }
  }
  const keptIndex = keepGroupsFromEnd(groups, retainTokens)
  const folded = groups.slice(0, keptIndex).flat()
  const tail = groups.slice(keptIndex).flat()
  const firstKept = groups[keptIndex]?.[0]
  const throughSeq = resolveCompactionThroughSeq(records, firstKept?.seq)
  const splitAtProcess = Boolean(firstKept && firstKept.entry.kind !== 'user')
  const turnStartIndex = splitAtProcess ? findTurnStartGroupIndex(groups, keptIndex) : -1
  if (turnStartIndex < 0) {
    return {
      folded,
      tail,
      history: folded,
      turnPrefix: [],
      isSplitTurn: false,
      firstKeptSeq: firstKept?.seq,
      throughSeq
    }
  }
  return {
    folded,
    tail,
    history: groups.slice(0, turnStartIndex).flat(),
    turnPrefix: groups.slice(turnStartIndex, keptIndex).flat(),
    isSplitTurn: true,
    firstKeptSeq: firstKept?.seq,
    throughSeq
  }
}

export const hasCompressibleCompactionHistory = (
  records: ChatMessageLogRecord[],
  retainTokens: number
): boolean => splitLogForCompactionTail(records, retainTokens).folded.length > 0
