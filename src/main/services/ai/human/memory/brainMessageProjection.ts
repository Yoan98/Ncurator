import type { BaseMessage } from '@langchain/core/messages'
import type { ChatMessageLogRecord } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanState } from '../types'
import { buildBrainUserMessage } from '../prompts/brain'
import { createCompactedBrainUserMessage, createCurrentBrainUserMessage } from '../node/utils/messageTail'
import {
  orderMessageLogBySeq,
  repairInterruptedToolCalls
} from './transcript'
import { messagesFromLogEntries } from './conversationLogMessages'
import { wrapCompactionCheckpointContent } from '../prompts/compaction'

export type BrainMessagesProjection = {
  messages: BaseMessage[]
  currentUserMessageIndex: number
}

export const projectBrainMessagesFromLog = (input: {
  records: ChatMessageLogRecord[]
  ctx: AiRunContext
  state: HumanState
}): BrainMessagesProjection => {
  const ordered = orderMessageLogBySeq(input.records)
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
      ? compactionCheckpointRecord.entry.payload
      : undefined

  const projectedRecords = compactionCheckpoint
    ? ordered.filter((record) => record.seq > compactionCheckpoint.coveredThroughSeq)
    : ordered

  for (const record of projectedRecords) {
    if (record.entry.kind === 'user' && !record.entry.content.trim()) {
      throw new Error(`log user（seq=${record.seq}）的 content 不能为空。`)
    }
  }

  const messages: BaseMessage[] = []
  const checkpointSummary = compactionCheckpoint?.summary.trim()
  if (checkpointSummary) {
    messages.push(createCompactedBrainUserMessage(wrapCompactionCheckpointContent(checkpointSummary)))
  }
  messages.push(...messagesFromLogEntries(projectedRecords.map((record) => record.entry)))
  messages.push(
    createCurrentBrainUserMessage(
      buildBrainUserMessage({
        state: input.state,
        ctx: input.ctx
      })
    )
  )

  const repaired = repairInterruptedToolCalls(messages)
  return {
    messages: repaired,
    currentUserMessageIndex: repaired.length - 1
  }
}
