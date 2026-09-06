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
import { repairInterruptedToolCalls, sliceAfterLastContextCleared } from './transcript'
import { resolveHistoricalBrainUserTextsByUserSeq } from './brainUserSnapshot'

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
  memoryText?: string
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

  const projectedRecords = checkpoint
    ? afterCleared.filter((record) => record.seq > checkpoint.coveredThroughSeq)
    : afterCleared

  const frozenBrainUserByUserSeq = resolveHistoricalBrainUserTextsByUserSeq(afterCleared)
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
      const frozenText = frozenBrainUserByUserSeq.get(record.seq)
      if (!frozenText) {
        throw new Error(
          `历史 build user 缺少 brain_user_snapshot（user seq=${record.seq}）。resume 必须还原上次发给模型的原文，禁止重算。`
        )
      }
      messages.push(new HumanMessage(frozenText))
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

  const injectActiveState =
    Boolean(input.memoryText?.trim()) ||
    projectedRecords.some((record) => record.entry.kind === 'user')

  messages.push(
    createCurrentBrainUserMessage(
      buildBrainUserMessage({
        state: input.state,
        ctx: input.ctx,
        memoryText: input.memoryText,
        injectActiveState
      })
    )
  )

  const repaired = repairInterruptedToolCalls(messages)
  return {
    messages: repaired,
    currentUserMessageIndex: repaired.length - 1
  }
}
