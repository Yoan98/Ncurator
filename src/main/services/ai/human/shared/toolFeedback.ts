import type { ChatMessageLogEntry } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRuntimeCache } from '../types'
import { appendLogEntriesToCache } from '../memory/conversationLogMessages'

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

export const buildToolFeedback = (input: ToolFeedbackInput): ChatMessageLogEntry => {
  const content = buildContent(input)
  return {
    kind: 'tool',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ok: input.ok,
    content
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
  additionalTranscriptEntries?: ChatMessageLogEntry[]
}): Promise<void> => {
  const transcript = buildToolFeedback(input)
  appendLogEntriesToCache(input.cache, [transcript])
  await input.ctx.appendMessageLog([
    transcript,
    ...(input.additionalTranscriptEntries || [])
  ])
}
