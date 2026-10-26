import type { ChatMessageLogEntry, JsonObject } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { HumanRuntimeCache } from '../types'
import { appendLogEntriesToCache } from '../memory/conversationLogMessages'
import { readToolErrorMessage, renderToolError, resolveToolErrorMessage } from './toolError'

export type ToolFeedbackInput = {
  toolCallId: string
  toolName: string
  ok: boolean
  errorMessage?: string
  content?: string
  displayInput?: JsonObject
}

export const buildToolFeedback = (input: ToolFeedbackInput): ChatMessageLogEntry => {
  const explicitContent = input.content?.trim()
  const error = input.ok
    ? undefined
    : resolveToolErrorMessage(
        input.toolName,
        readToolErrorMessage(input.errorMessage) || explicitContent?.replace(/^Error:\s*/u, '')
      )
  let content = explicitContent
  if (!content) {
    content = input.ok
      ? 'Tool feedback completed successfully.'
      : renderToolError(input.toolName, error)
  } else if (error && !content.includes(error)) {
    content = `${renderToolError(input.toolName, error)}\n${content}`
  }
  return {
    kind: 'tool',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ok: input.ok,
    content,
    displayInput: input.displayInput,
    error
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
  displayInput?: JsonObject
  additionalTranscriptEntries?: ChatMessageLogEntry[]
}): Promise<void> => {
  const transcript = buildToolFeedback(input)
  appendLogEntriesToCache(input.cache, [transcript])
  await input.ctx.appendMessageLog([transcript, ...(input.additionalTranscriptEntries || [])])
}
