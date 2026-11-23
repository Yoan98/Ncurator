import type { ChatMessageLogRecord } from './types'

export const normalizeThoughtText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

/** The same public progress text shown in the assistant's process area. */
export function* assistantProcessTextInLog(
  records: readonly Pick<ChatMessageLogRecord, 'entry' | 'seq' | 'createdAt'>[]
) {
  let thinkingOpen = false
  for (const record of records) {
    const { entry } = record
    if (entry.kind === 'annotation') {
      if (entry.eventType === 'thinking_started') thinkingOpen = true
      else if (entry.eventType === 'thinking_completed') thinkingOpen = false
    } else if (entry.kind === 'assistant' && thinkingOpen) {
      const text = normalizeThoughtText(entry.content)
      if (text) yield { record, text }
    }
  }
}
