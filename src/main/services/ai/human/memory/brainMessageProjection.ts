import type { BaseMessage } from '@langchain/core/messages'
import type { ChatMessageLogRecord } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanState } from '../types'
import { buildBrainUserMessage } from '../prompts/brain'
import { wrapCompactionCheckpointContent } from '../prompts/compaction'
import {
  createCompactedBrainUserMessage,
  createCurrentBrainUserMessage
} from '../node/utils/messageTail'
import { orderMessageLogBySeq, repairInterruptedToolCalls, resolveHistoryFloor } from './transcript'
import { messagesFromLogEntries } from './conversationLogMessages'

export type BrainMessagesProjection = {
  messages: BaseMessage[]
  currentUserMessageIndex: number
}

const buildCurrentUserMessage = (input: { ctx: AiRunContext; state: HumanState }): BaseMessage =>
  createCurrentBrainUserMessage(
    buildBrainUserMessage({
      state: input.state,
      ctx: input.ctx
    })
  )

export const projectBrainMessagesFromLog = (input: {
  records: ChatMessageLogRecord[]
  ctx: AiRunContext
  state: HumanState
  appendCurrentUser?: boolean
}): BrainMessagesProjection => {
  const ordered = orderMessageLogBySeq(input.records)
  const appendCurrentUser = input.appendCurrentUser !== false
  const messages: BaseMessage[] = []
  const floor = resolveHistoryFloor(ordered)
  const projectedRecords = ordered.filter((record) => record.seq > floor.historyFloorSeq)

  for (const record of projectedRecords) {
    if (record.entry.kind === 'user' && !record.entry.content.trim()) {
      throw new Error(`log user（seq=${record.seq}）的 content 不能为空。`)
    }
  }

  const checkpointSummary = floor.compactionCheckpoint?.summary.trim()
  if (checkpointSummary) {
    messages.push(
      createCompactedBrainUserMessage(wrapCompactionCheckpointContent(checkpointSummary))
    )
  }
  messages.push(...messagesFromLogEntries(projectedRecords.map((record) => record.entry)))

  if (appendCurrentUser) {
    messages.push(buildCurrentUserMessage(input))
  }

  const repaired = repairInterruptedToolCalls(messages, ordered)
  return {
    messages: repaired,
    currentUserMessageIndex: repaired.length > 0 ? repaired.length - 1 : 0
  }
}
