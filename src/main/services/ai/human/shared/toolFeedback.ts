import { ToolMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRuntimeCache } from '../types'

export type ToolFeedbackInput = {
  toolCallId: string
  toolName: string
  ok: boolean
  errorMessage?: string
  content?: string
}

const buildContent = (input: ToolFeedbackInput): string => {
  if (input.content) return input.content
  if (input.ok) return 'Tool feedback completed successfully.'
  const error = input.errorMessage ?? 'The tool call failed.'
  return /^[\x20-\x7E\r\n\t]+$/u.test(error)
    ? `Error: ${error}`
    : 'Error: The tool call failed. Check the tool arguments and try again.'
}

export const buildToolFeedback = (
  input: ToolFeedbackInput
): {
  message: ToolMessage
  transcript: ChatMessageLogEntry
} => {
  const content = buildContent(input)
  return {
    message: new ToolMessage({
      content,
      tool_call_id: input.toolCallId
    }),
    transcript: {
      kind: 'tool',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      ok: input.ok,
      content
    }
  }
}

export const appendToolFeedback = async (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  toolCallId: string
  toolName: string
  ok: boolean
  errorMessage?: string
  content?: string
}): Promise<void> => {
  const feedback = buildToolFeedback(input)
  const messages = input.cache.messages || []
  messages.push(feedback.message)
  input.cache.messages = messages
  await input.ctx.appendMessageLog([feedback.transcript])
}
