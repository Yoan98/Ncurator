import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { normalizeThoughtText } from '../../../../../../shared/thoughtText'

const CURRENT_USER_MARKER = 'ncurator_current_user'
const COMPACTION_USER_MARKER = 'ncurator_compaction_user'

export const createCurrentBrainUserMessage = (content: string): HumanMessage =>
  new HumanMessage({
    content,
    additional_kwargs: { [CURRENT_USER_MARKER]: true }
  })

export const createCompactedBrainUserMessage = (content: string): HumanMessage =>
  new HumanMessage({
    content,
    additional_kwargs: {
      [CURRENT_USER_MARKER]: true,
      [COMPACTION_USER_MARKER]: true
    }
  })

export const isCurrentBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[CURRENT_USER_MARKER] === true

export const isCompactedBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[COMPACTION_USER_MARKER] === true

export const listFoldableHistoryMessages = (messages: BaseMessage[]): BaseMessage[] =>
  messages.filter(
    (message) => message.getType() !== 'system' && !isCurrentBrainUserMessage(message)
  )

export const splitMessagesForMemoryCompaction = (
  messages: BaseMessage[]
): { current: BaseMessage[]; earlier: BaseMessage[] } => {
  const current: BaseMessage[] = []
  const earlier: BaseMessage[] = []
  let seenCurrentUser = false
  for (const message of messages) {
    if (message.getType() === 'system') continue
    if (isCurrentBrainUserMessage(message)) {
      seenCurrentUser = true
      current.push(message)
      continue
    }
    if (seenCurrentUser) {
      current.push(message)
    } else {
      earlier.push(message)
    }
  }
  if (!seenCurrentUser) {
    return { current: earlier, earlier: [] }
  }
  return { current, earlier }
}

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
  return `[tool] ${normalizeCompactionText(rawContent)}`
}

// 每个 AI 消息及其触发的工具调用、紧随的工具结果为一轮，轮首加 [round N]。
// 轮内 \n 紧凑，轮间 \n\n 分隔。
export const renderMessagesForCompaction = (messages: BaseMessage[]): string => {
  const rounds: string[] = []
  let roundLines: string[] = []
  let roundIndex = 0
  const flushRound = (): void => {
    if (roundLines.length > 0) {
      rounds.push(roundLines.join('\n'))
      roundLines = []
    }
  }
  for (const message of messages) {
    const role = message.getType()
    if (role === 'ai') {
      flushRound()
      roundIndex += 1
      roundLines = [`[round ${roundIndex}]`, ...renderAiMessageLines(message as AIMessage)]
    } else if (role === 'tool') {
      roundLines.push(renderToolMessageLine(message))
    } else if (role === 'human') {
      flushRound()
      roundIndex += 1
      const rawContent =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      const content = normalizeCompactionText(rawContent)
      roundLines = [`[round ${roundIndex}]`, '[user]']
      if (content) roundLines.push(content)
    }
  }
  flushRound()
  return rounds.join('\n\n')
}
