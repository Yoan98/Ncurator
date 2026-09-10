import type { BaseMessage } from '@langchain/core/messages'
import type { ChatMessageLogRecord } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanState } from '../types'
import { buildBrainUserMessage } from '../prompts/brain'
import { wrapCompactionCheckpointContent } from '../prompts/compaction'
import { wrapTaskCatalogContent } from '../prompts/contextScope'
import {
  createCatalogBrainUserMessage,
  createCompactedBrainUserMessage,
  createCurrentBrainUserMessage
} from '../node/utils/messageTail'
import {
  orderMessageLogBySeq,
  repairInterruptedToolCalls,
  resolveHistoryFloor,
  resolveMaxMessageLogSeq
} from './transcript'
import { messagesFromLogEntries } from './conversationLogMessages'
import {
  collectRunDigestCatalogEntries,
  renderRunDigestCatalog
} from './runDigestCatalog'

export type BrainMessagesProjection = {
  messages: BaseMessage[]
  currentUserMessageIndex: number
}

const buildCurrentUserMessage = (input: {
  ctx: AiRunContext
  state: HumanState
}): BaseMessage =>
  createCurrentBrainUserMessage(
    buildBrainUserMessage({
      state: input.state,
      ctx: input.ctx
    })
  )

/**
 * 目录只列原文已经不在上下文里的任务：`seq <= archivedThroughSeq` 的 `run_digest`。
 * 没压过也没丢过时（`archivedThroughSeq < 0`）历史原文本身就是全量，目录纯属重复，不注入。
 */
const appendArchivedCatalogUser = (input: {
  messages: BaseMessage[]
  records: readonly ChatMessageLogRecord[]
  archivedThroughSeq: number
}): void => {
  if (input.archivedThroughSeq < 0) return
  const archived = input.records.filter((record) => record.seq <= input.archivedThroughSeq)
  const catalogText = renderRunDigestCatalog(collectRunDigestCatalogEntries(archived))
  const wrapped = wrapTaskCatalogContent(catalogText)
  if (!wrapped) return
  input.messages.push(createCatalogBrainUserMessage(wrapped))
}

export const projectBrainMessagesFromLog = (input: {
  records: ChatMessageLogRecord[]
  ctx: AiRunContext
  state: HumanState
  needsHistory?: boolean
}): BrainMessagesProjection => {
  const ordered = orderMessageLogBySeq(input.records)
  const needsHistory = input.needsHistory !== false
  const messages: BaseMessage[] = []
  // 不带历史时本轮会把整段原文丢掉（即将写入 discard_checkpoint），因此全部任务都算归档。
  let archivedThroughSeq = resolveMaxMessageLogSeq(ordered)

  if (needsHistory) {
    const floor = resolveHistoryFloor(ordered)
    archivedThroughSeq = floor.historyFloorSeq
    const projectedRecords = ordered.filter((record) => record.seq > floor.historyFloorSeq)

    for (const record of projectedRecords) {
      if (record.entry.kind === 'user' && !record.entry.content.trim()) {
        throw new Error(`log user（seq=${record.seq}）的 content 不能为空。`)
      }
    }

    const checkpointSummary = floor.compactionCheckpoint?.summary.trim()
    if (floor.includeCheckpoint && checkpointSummary) {
      messages.push(
        createCompactedBrainUserMessage(wrapCompactionCheckpointContent(checkpointSummary))
      )
    }
    messages.push(...messagesFromLogEntries(projectedRecords.map((record) => record.entry)))
  }

  // 目录落在历史之后、本轮 User 之前：属于本轮新内容，不动已缓存前缀。
  appendArchivedCatalogUser({ messages, records: ordered, archivedThroughSeq })
  messages.push(buildCurrentUserMessage(input))

  const repaired = repairInterruptedToolCalls(messages)
  return {
    messages: repaired,
    currentUserMessageIndex: repaired.length - 1
  }
}
