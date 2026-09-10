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
  resolveHistoryFloor
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

const appendCatalogUserIfPresent = (
  messages: BaseMessage[],
  records: readonly ChatMessageLogRecord[]
): void => {
  const catalogText = renderRunDigestCatalog(collectRunDigestCatalogEntries(records))
  const wrapped = wrapTaskCatalogContent(catalogText)
  if (!wrapped) return
  messages.push(createCatalogBrainUserMessage(wrapped))
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

  if (needsHistory) {
    const floor = resolveHistoryFloor(ordered)
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

  // 目录固定落在历史之后、本轮 User 之前：两条路径都能按路径找回旧任务，且不动已缓存前缀。
  appendCatalogUserIfPresent(messages, ordered)
  messages.push(buildCurrentUserMessage(input))

  const repaired = repairInterruptedToolCalls(messages)
  return {
    messages: repaired,
    currentUserMessageIndex: repaired.length - 1
  }
}
