/**
 * Coarse outline of one local day's conversation, used by the right-side rail.
 *
 * Items follow the day selected on the left timeline, one item per message, so
 * the rail stays cheap: pure string work, no DOM, no markdown parsing.
 */

import type { ChatMessage } from '../types'
import { startOfLocalDay } from './messageTimeline'

export type ConversationOutlineItemKind = 'user' | 'assistant'

export type ConversationOutlineItem = {
  id: string
  kind: ConversationOutlineItemKind
  /** First non-empty line, markdown markers stripped and truncated. */
  title: string
  /** Remaining lines collapsed into one preview paragraph; may be empty. */
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

/** Plain-text preview pair: first line as title, the rest as snippet. */
export const buildOutlinePreview = (raw: string): { title: string; snippet: string } => {
  const lines = stripFencedCode(raw)
    .split('\n')
    .map((line) => stripLineMarkers(line.trim()))
    .filter((line) => line.length > 0)
  if (lines.length === 0) return { title: '', snippet: '' }
  return {
    title: truncate(collapseWhitespace(lines[0]), TITLE_MAX_CHARS),
    snippet: truncate(collapseWhitespace(lines.slice(1).join(' ')), SNIPPET_MAX_CHARS)
  }
}

const lengthLevelOf = (content: string): 1 | 2 | 3 => {
  const size = collapseWhitespace(content).length
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
}): ConversationOutlineItem[] => {
  const { messages } = input
  if (messages.length === 0) return []
  const scopeDay = input.dayStart ?? startOfLocalDay(messages[messages.length - 1].timestamp)

  const items: ConversationOutlineItem[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (startOfLocalDay(message.timestamp) !== scopeDay) continue
    const raw = message.content || ''
    if (!raw.trim()) continue
    const preview = buildOutlinePreview(raw)
    if (!preview.title) continue
    items.push({
      id: message.id,
      kind: message.role,
      title: preview.title,
      snippet: preview.snippet,
      lengthLevel: lengthLevelOf(raw),
      timestamp: message.timestamp
    })
  }
  return sampleItems(items)
}
