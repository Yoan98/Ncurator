import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { normalizeThoughtText } from '../../../../../../shared/thoughtText'
import { estimateMessagesForContext } from '../../memory/multimodal'

const CURRENT_USER_MARKER = 'ncurator_current_user'
const COMPACTION_USER_MARKER = 'ncurator_compaction_user'
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

export const isCurrentBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[CURRENT_USER_MARKER] === true

export const isCompactedBrainUserMessage = (message: BaseMessage): boolean =>
  message.getType() === 'human' && message.additional_kwargs?.[COMPACTION_USER_MARKER] === true

const isImageReferenceHuman = (message: BaseMessage): boolean =>
  message.getType() === 'human' && typeof message.content !== 'string'

const isBoundaryUser = (message: BaseMessage): boolean =>
  message.getType() === 'human' && !isImageReferenceHuman(message)

const groupMessagesForCompaction = (messages: BaseMessage[]): BaseMessage[][] => {
  const groups: BaseMessage[][] = []
  let current: BaseMessage[] = []
  const flush = (): void => {
    if (current.length === 0) return
    groups.push(current)
    current = []
  }
  for (const message of messages) {
    if (isBoundaryUser(message) || message.getType() === 'ai') {
      flush()
      current = [message]
      continue
    }
    if (current.length === 0) {
      current = [message]
      continue
    }
    current.push(message)
  }
  flush()
  return groups
}

const keepGroupsFromEnd = (
  groups: BaseMessage[][],
  retainTokens: number
): number => {
  if (groups.length === 0) return 0
  let used = 0
  let firstKeptIndex = groups.length
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (!group) continue
    const cost = estimateMessagesForContext(group)
    if (firstKeptIndex === groups.length || used + cost <= retainTokens) {
      firstKeptIndex = index
      used += cost
      continue
    }
    break
  }
  return firstKeptIndex
}

const findTurnStartGroupIndex = (
  groups: BaseMessage[][],
  beforeIndex: number
): number => {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (group?.[0] && isBoundaryUser(group[0])) return index
  }
  return -1
}

export type CompactionMessageSplit = {
  folded: BaseMessage[]
  tail: BaseMessage[]
  history: BaseMessage[]
  turnPrefix: BaseMessage[]
  isSplitTurn: boolean
}

export const splitMessagesForCompactionTail = (
  messages: BaseMessage[],
  retainTokens: number
): CompactionMessageSplit => {
  const compactable = messages.filter(
    (message) => message.getType() !== 'system' && !isCompactedBrainUserMessage(message)
  )
  const groups = groupMessagesForCompaction(compactable)
  if (groups.length === 0) {
    return { folded: [], tail: [], history: [], turnPrefix: [], isSplitTurn: false }
  }
  const keptIndex = keepGroupsFromEnd(groups, retainTokens)
  const folded = groups.slice(0, keptIndex).flat()
  const tail = groups.slice(keptIndex).flat()
  const firstKept = groups[keptIndex]
  const splitAtProcess = Boolean(firstKept?.[0] && !isBoundaryUser(firstKept[0]))
  const turnStartIndex = splitAtProcess ? findTurnStartGroupIndex(groups, keptIndex) : -1
  if (turnStartIndex < 0) {
    return {
      folded,
      tail,
      history: folded,
      turnPrefix: [],
      isSplitTurn: false
    }
  }
  return {
    folded,
    tail,
    history: groups.slice(0, turnStartIndex).flat(),
    turnPrefix: groups.slice(turnStartIndex, keptIndex).flat(),
    isSplitTurn: true
  }
}

export const hasCompressibleCompactionHistory = (
  messages: BaseMessage[],
  retainTokens: number
): boolean => {
  const { folded } = splitMessagesForCompactionTail(messages, retainTokens)
  return folded.length > 0
}

export const countTailBookmarkMessages = (tail: BaseMessage[]): number =>
  tail.filter(
    (message) =>
      message.getType() === 'ai' || message.getType() === 'tool' || isBoundaryUser(message)
  ).length

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
  const blocks: string[] = []
  let processLines: string[] = []
  const flushProcess = (): void => {
    if (processLines.length === 0) return
    blocks.push(processLines.join('\n'))
    processLines = []
  }
  for (const message of messages) {
    const role = message.getType()
    if (isBoundaryUser(message)) {
      flushProcess()
      blocks.push(renderHumanBlock(message))
      continue
    }
    if (role === 'ai') {
      processLines.push(...renderAiMessageLines(message as AIMessage))
      continue
    }
    if (role === 'tool') {
      processLines.push(renderToolMessageLine(message))
      continue
    }
    if (role === 'human') {
      processLines.push(renderHumanBlock(message))
    }
  }
  flushProcess()
  return blocks.join('\n\n')
}
