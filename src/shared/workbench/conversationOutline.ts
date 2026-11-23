/**
 * Coarse outline of one local day's conversation, used by the right-side rail.
 *
 * Items follow the question's local day, one item per user question, so
 * the rail stays cheap: pure string work, no DOM, no markdown parsing.
 */

import type { ChatMessage } from '../types'
import { startOfLocalDay } from './messageTimeline'

export type ConversationOutlineItemKind = 'user' | 'assistant'

export type ConversationOutlineItem = {
  id: string
  kind: ConversationOutlineItemKind
  /** User message preview. */
  title: string
  /** Latest final answer, or the latest available reply. */
  snippet: string
  /** Tick width bucket: short / medium / long content. */
  lengthLevel: 1 | 2 | 3
  timestamp: number
}

export const MAX_OUTLINE_ITEMS = 40
const TITLE_MAX_CHARS = 32
const SNIPPET_MAX_CHARS = 120
const LEVEL_2_CHARS = 200
const LEVEL_3_CHARS = 800

const collapseWhitespace = (value: string): string => value.replace(/\s+/gu, ' ').trim()

const stripLineMarkers = (line: string): string =>
  line
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^>\s?/u, '')
    .replace(/^[-*+]\s+/u, '')
    .replace(/^\d{1,3}[.)]\s+/u, '')

const truncate = (value: string, maxChars: number): string =>
  value.length > maxChars ? `${value.slice(0, maxChars).trimEnd()}…` : value

const stripFencedCode = (value: string): string => value.replace(/```[\s\S]*?```/gu, ' ')
const INLINE_LINK = /!?\[([^\]\n[]*)\]\((?:<[^>\n]*>|(?:\\[^\n]|[^()\n\\]|\([^()\n]*\))*)\)/gu

export const outlinePreviewText = (raw: string): string => {
  const prose = stripFencedCode(raw).trim()
  return collapseWhitespace(
    (prose ? prose.replace(INLINE_LINK, '$1') : raw.replace(/^[\t ]*```[^\n]*$/gmu, ''))
      .split('\n')
      .map((line) => stripLineMarkers(line.trim()))
      .join(' ')
  )
}

type OutlineReply = { text: string; final: boolean }

const defaultReply = (message: ChatMessage): OutlineReply =>
  !message.error && message.content.trim()
    ? { text: message.content, final: true }
    : { text: message.assistantProgressText || '', final: false }

const lengthLevelOf = (size: number): 1 | 2 | 3 => {
  if (size < LEVEL_2_CHARS) return 1
  if (size < LEVEL_3_CHARS) return 2
  return 3
}

/** Even sampling keeps first/last and stays under the cap. */
const sampleItems = (items: readonly ConversationOutlineItem[]): ConversationOutlineItem[] => {
  if (items.length <= MAX_OUTLINE_ITEMS) return [...items]
  const lastIndex = items.length - 1
  const step = lastIndex / (MAX_OUTLINE_ITEMS - 1)
  return Array.from({ length: MAX_OUTLINE_ITEMS }, (_, index) => items[Math.round(index * step)])
}

export const buildConversationOutline = (input: {
  messages: readonly ChatMessage[]
  dayStart: number | null
  resolveReply?: (message: ChatMessage) => OutlineReply | undefined
}): ConversationOutlineItem[] => {
  const { messages, resolveReply } = input
  if (messages.length === 0) return []
  const latest = messages[messages.length - 1]
  const scopeDay =
    input.dayStart ??
    startOfLocalDay(resolveConversationQuestion(messages, latest.id)?.timestamp ?? latest.timestamp)

  const groups = new Map<
    string,
    { message: ChatMessage; title: string; length: number; reply?: OutlineReply }
  >()
  for (const message of messages) {
    if (message.role !== 'user' || startOfLocalDay(message.timestamp) !== scopeDay) continue
    const content =
      message.content.trim() ||
      message.attachments?.map((item) => item.name).join(' ') ||
      message.selectedReferences?.map((item) => item.name).join(' ') ||
      ''
    groups.set(message.id, {
      message,
      title: truncate(outlinePreviewText(content), TITLE_MAX_CHARS),
      length: collapseWhitespace(content).length
    })
  }
  let previousUserId: string | undefined
  for (const message of messages) {
    if (message.role === 'user') previousUserId = message.id
    if (message.role !== 'assistant') continue
    const group = groups.get(message.userMessageId || previousUserId || '')
    if (!group) continue
    const { text, final } = resolveReply?.(message) ?? defaultReply(message)
    if (text.trim()) group.length += collapseWhitespace(text).length + Number(group.length > 0)
    if (group.reply?.final && !final) continue
    const preview = outlinePreviewText(text)
    if (preview) group.reply = { text: truncate(preview, SNIPPET_MAX_CHARS), final }
  }
  const items: ConversationOutlineItem[] = []
  for (const { message, title, length, reply } of groups.values()) {
    if (!title && !reply) continue
    items.push({
      id: message.id,
      kind: 'user',
      title,
      snippet: reply?.text || '',
      lengthLevel: lengthLevelOf(length),
      timestamp: message.timestamp
    })
  }
  return sampleItems(items)
}

/** Older messages without ownership metadata follow their preceding user question. */
export const resolveConversationQuestion = (
  messages: readonly ChatMessage[],
  messageId: string
): ChatMessage | undefined => {
  const index = messages.findIndex((message) => message.id === messageId)
  const message = messages[index]
  if (!message || message.role === 'user') return message
  if (message.userMessageId) return messages.find((item) => item.id === message.userMessageId)
  return messages
    .slice(0, index)
    .reverse()
    .find((item) => item.role === 'user')
}
