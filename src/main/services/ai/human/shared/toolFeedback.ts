import { ToolMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry, JsonObject } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRuntimeCache } from '../types'

export const TOOL_FEEDBACK_ERROR_CODES = [
  'invalid_json',
  'invalid_plan',
  'approval_blocked',
  'pending_items'
] as const

export type ToolFeedbackErrorCode = (typeof TOOL_FEEDBACK_ERROR_CODES)[number]

type ToolFeedbackEnvelope = JsonObject

export type ToolFeedbackInput = {
  toolCallId: string
  toolName: string
  ok: boolean
  data?: JsonObject
  errorCode?: ToolFeedbackErrorCode
  errorMessage?: string
}

const buildEnvelope = (input: ToolFeedbackInput): ToolFeedbackEnvelope => {
  if (input.ok) {
    return { ok: true, ...(input.data || {}) }
  }
  const envelope: JsonObject = { ok: false }
  if (input.errorCode) envelope.code = input.errorCode
  if (input.errorMessage) envelope.error = input.errorMessage
  return envelope
}

export const buildToolFeedback = (input: ToolFeedbackInput): {
  message: ToolMessage
  transcript: ChatMessageLogEntry
} => {
  const envelope = buildEnvelope(input)
  return {
    message: new ToolMessage({
      content: JSON.stringify(envelope),
      tool_call_id: input.toolCallId
    }),
    transcript: {
      kind: 'tool',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ok: input.ok,
      result: envelope
    }
  }
}

export const appendToolFeedback = async (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  toolCallId: string
  toolName: string
  ok: boolean
  data?: JsonObject
  errorCode?: ToolFeedbackErrorCode
  errorMessage?: string
}): Promise<void> => {
  const feedback = buildToolFeedback(input)
  const messages = input.cache.messages || []
  messages.push(feedback.message)
  input.cache.messages = messages
  await input.ctx.appendMessageLog([feedback.transcript])
}
