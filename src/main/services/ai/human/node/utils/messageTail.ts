import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { normalizeThoughtText } from '../../../../../../shared/thoughtText'

const CURRENT_USER_MARKER = 'ncurator_current_user'
const COMPACTION_USER_MARKER = 'ncurator_compaction_user'
const DISCARD_USER_MARKER = 'ncurator_discard_user'
const COMPACTION_TOOL_RESULT_MAX_CHARS = 2000

export const createCurrentBrainUserMessage = (content: string): HumanMessage =>
  new HumanMessage({
    content,
    additional_kwargs: { [CURRENT_USER_MARKER]: true }
  })

export const createCompactedBrainUserMessage = (content: string): HumanMessage =>
  new HumanMessage({
    content,
    additional_kwargs: {
      [COMPACTION_USER_MARKER]: true
    }
  })

export const createDiscardBrainUserMessage = (content: string): HumanMessage =>
  new HumanMessage({
    content,
    additional_kwargs: {
      [DISCARD_USER_MARKER]: true
    }
  })

export const isCurrentBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[CURRENT_USER_MARKER] === true

export const isCompactedBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[COMPACTION_USER_MARKER] === true

export const isDiscardBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[DISCARD_USER_MARKER] === true

const isSyntheticHistoryUserMessage = (message: BaseMessage): boolean =>
  isCompactedBrainUserMessage(message) || isDiscardBrainUserMessage(message)

const isImageReferenceHuman = (message: BaseMessage): boolean =>
  message.getType() === 'human' && typeof message.content !== 'string'

const isBoundaryUser = (message: BaseMessage): boolean =>
  message.getType() === 'human' &&
  !isImageReferenceHuman(message) &&
  !isSyntheticHistoryUserMessage(message)

const MAX_TOOL_CALL_ARG_LENGTH = 300

const formatToolCallArgValue = (value: unknown): string => {
  const rendered =
    typeof value === 'string' || (typeof value === 'object' && value !== null)
      ? JSON.stringify(value)
      : String(value)
  return rendered.length > MAX_TOOL_CALL_ARG_LENGTH
    ? `${rendered.slice(0, MAX_TOOL_CALL_ARG_LENGTH)}…`
    : rendered
}

const formatToolCallArgs = (args: Record<string, unknown>): string =>
  Object.entries(args)
    .map(([key, value]) => `${key}=${formatToolCallArgValue(value)}`)
    .join(', ')

const normalizeCompactionText = (content: string): string => content.trim()

const truncateCompactionToolBody = (content: string): string => {
  const characters = Array.from(content)
  if (characters.length <= COMPACTION_TOOL_RESULT_MAX_CHARS) return content
  const omitted = characters.length - COMPACTION_TOOL_RESULT_MAX_CHARS
  return `${characters.slice(0, COMPACTION_TOOL_RESULT_MAX_CHARS).join('')}\n\n... [${omitted} characters omitted]`
}

const renderAiMessageLines = (message: AIMessage): string[] => {
  const lines: string[] = []
  const rawContent =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  const content =
    typeof message.content === 'string' ? normalizeThoughtText(rawContent) : normalizeCompactionText(rawContent)
  if (content) {
    lines.push(`[ai] ${content}`)
  }
  const toolCalls = message.tool_calls
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      const name = typeof call?.name === 'string' && call.name ? call.name : 'unknown'
      const args = (call?.args ?? {}) as Record<string, unknown>
      lines.push(`[tool_call] ${name}(${formatToolCallArgs(args)})`)
    }
  }
  return lines
}

const renderToolMessageLine = (message: BaseMessage): string => {
  const rawContent =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return `[tool] ${truncateCompactionToolBody(normalizeCompactionText(rawContent))}`
}

const renderHumanBlock = (message: BaseMessage): string => {
  const rawContent =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  const content = normalizeCompactionText(rawContent)
  return content ? `[user]\n${content}` : '[user]'
}

export const renderMessagesForCompaction = (messages: BaseMessage[]): string => {
  const turns: string[] = []
  let currentTurn: string[] = []
  const flushTurn = (): void => {
    if (currentTurn.length === 0) return
    turns.push(currentTurn.join('\n'))
    currentTurn = []
  }
  for (const message of messages) {
    const role = message.getType()
    if (isBoundaryUser(message)) {
      flushTurn()
      currentTurn.push(renderHumanBlock(message))
      continue
    }
    if (role === 'ai') {
      currentTurn.push(...renderAiMessageLines(message as AIMessage))
      continue
    }
    if (role === 'tool') {
      currentTurn.push(renderToolMessageLine(message))
      continue
    }
    if (role === 'human') {
      currentTurn.push(renderHumanBlock(message))
    }
  }
  flushTurn()
  return turns.join('\n\n')
}
