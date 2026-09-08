import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type {
  ChatMessageImageRef,
  ChatMessageLogRecord,
  ChatMessageLogToolCall
} from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanState } from '../types'
import { buildBrainUserMessage } from '../prompts/brain'
import { createImageReferenceMessage } from './multimodal'
import { createCurrentBrainUserMessage } from '../node/utils/messageTail'
import {
  orderProjectedRecordsForBrain,
  repairInterruptedToolCalls,
  sliceAfterLastContextCleared
} from './transcript'

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

export type BrainMessagesProjection = {
  messages: BaseMessage[]
  currentUserMessageIndex: number
}

export const projectBrainMessagesFromLog = (input: {
  records: ChatMessageLogRecord[]
  ctx: AiRunContext
  state: HumanState
}): BrainMessagesProjection => {
  const afterCleared = sliceAfterLastContextCleared(input.records)
  const checkpointRecord = [...afterCleared]
    .reverse()
    .find(
      (record) =>
        record.entry.kind === 'annotation' &&
        record.entry.eventType === 'compaction_checkpoint'
    )
  const checkpoint =
    checkpointRecord?.entry.kind === 'annotation' &&
    checkpointRecord.entry.eventType === 'compaction_checkpoint'
      ? checkpointRecord.entry.payload
      : undefined

  const projectedRecords = orderProjectedRecordsForBrain(
    checkpoint
      ? afterCleared.filter((record) => record.seq > checkpoint.coveredThroughSeq)
      : afterCleared
  )

  const messages: BaseMessage[] = []
  let pendingImages: ChatMessageImageRef[] = []
  const flushImages = (): void => {
    if (pendingImages.length === 0) return
    messages.push(createImageReferenceMessage(pendingImages))
    pendingImages = []
  }

  for (const record of projectedRecords) {
    const entry = record.entry
    if (entry.kind === 'user') {
      flushImages()
      const text = entry.content.trim()
      if (!text) {
        throw new Error(`log user（seq=${record.seq}）的 content 不能为空。`)
      }
      messages.push(new HumanMessage(text))
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
    }
  }
  flushImages()

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
