import type { BaseMessage } from '@langchain/core/messages'
import type { ChatMessageLogRecord } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanState } from '../types'
import { resolveContextWindowTokens, resolveDiscardHistoryTokens } from '../constants'
import { buildBrainUserMessage } from '../prompts/brain'
import { wrapCompactionCheckpointContent } from '../prompts/compaction'
import { wrapDiscardConversationHistory } from '../prompts/contextScope'
import {
  createCompactedBrainUserMessage,
  createCurrentBrainUserMessage,
  createDiscardBrainUserMessage
} from '../node/utils/messageTail'
import {
  orderMessageLogBySeq,
  repairInterruptedToolCalls,
  resolveHistoryFloor
} from './transcript'
import { messagesFromLogEntries } from './conversationLogMessages'
import { assembleConversationHistory } from './runDigestCatalog'

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

const appendDiscardUser = (messages: BaseMessage[], conversationHistory: string): void => {
  const wrapped = wrapDiscardConversationHistory(conversationHistory)
  if (!wrapped) return
  messages.push(createDiscardBrainUserMessage(wrapped))
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
  const contextWindowTokens = resolveContextWindowTokens(
    input.ctx.humanRuntimeOverrides?.modelContextWindowTokens
  )
  const discardHistoryTokens = resolveDiscardHistoryTokens(contextWindowTokens)

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
    } else if (floor.includeDiscard) {
      appendDiscardUser(messages, floor.discardCheckpoint?.conversationHistory || '')
    }
    messages.push(...messagesFromLogEntries(projectedRecords.map((record) => record.entry)))
  } else {
    appendDiscardUser(messages, assembleConversationHistory(ordered, discardHistoryTokens))
  }

  messages.push(buildCurrentUserMessage(input))

  const repaired = repairInterruptedToolCalls(messages)
  return {
    messages: repaired,
    currentUserMessageIndex: repaired.length - 1
  }
}
