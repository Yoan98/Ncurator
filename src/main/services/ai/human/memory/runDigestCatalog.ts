import type { ChatMessageLogRecord } from '../../../../../shared/types'
import { estimateTextTokens } from '../utils/tokenEstimate'
import { orderMessageLogBySeq } from './transcript'

export type RunDigestCatalogEntry = {
  createdAt: number
  summary: string
  fileChangePaths: string[]
}

export type CompletedSessionBlock = {
  createdAt: number
  userInput: string
  delivery: string
  fileChangePaths: string[]
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export const formatCatalogTimestamp = (createdAt: number): string => {
  const date = new Date(createdAt)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export const collectRunDigestCatalogEntries = (
  records: readonly ChatMessageLogRecord[]
): RunDigestCatalogEntry[] => {
  const entries: RunDigestCatalogEntry[] = []
  for (const record of orderMessageLogBySeq([...records])) {
    if (record.entry.kind !== 'annotation' || record.entry.eventType !== 'run_digest') continue
    const summary = record.entry.payload.summary.trim()
    if (!summary) continue
    entries.push({
      createdAt: record.createdAt,
      summary,
      fileChangePaths: record.entry.payload.fileChangePaths.map((path) => path.trim()).filter(Boolean)
    })
  }
  return entries
}

export const renderRunDigestCatalog = (entries: readonly RunDigestCatalogEntry[]): string =>
  entries
    .map((entry) => {
      const time = formatCatalogTimestamp(entry.createdAt)
      const paths = entry.fileChangePaths.join(', ')
      return paths ? `${time} | ${entry.summary} | 改动文件：${paths}` : `${time} | ${entry.summary}`
    })
    .join('\n')

const isDeliveryAssistant = (record: ChatMessageLogRecord): boolean =>
  record.entry.kind === 'assistant' && record.entry.toolCalls.length === 0

const isRunDigestRecord = (
  record: ChatMessageLogRecord
): record is ChatMessageLogRecord & {
  entry: Extract<ChatMessageLogRecord['entry'], { eventType: 'run_digest' }>
} => record.entry.kind === 'annotation' && record.entry.eventType === 'run_digest'

export const collectCompletedSessionBlocks = (
  records: readonly ChatMessageLogRecord[]
): CompletedSessionBlock[] => {
  const ordered = orderMessageLogBySeq([...records])
  const blocks: CompletedSessionBlock[] = []
  let sliceStart = 0
  for (let index = 0; index < ordered.length; index += 1) {
    const digestRecord = ordered[index]
    if (!digestRecord || !isRunDigestRecord(digestRecord)) continue
    const slice = ordered.slice(sliceStart, index + 1)
    sliceStart = index + 1
    const userRecord = slice.find(
      (record) => record.entry.kind === 'user' && record.entry.input.trim()
    )
    if (!userRecord || userRecord.entry.kind !== 'user') continue
    const deliveryRecord = [...slice].reverse().find(isDeliveryAssistant)
    const delivery =
      deliveryRecord?.entry.kind === 'assistant' ? deliveryRecord.entry.content.trim() : ''
    const userInput = userRecord.entry.input.trim()
    if (!userInput && !delivery) continue
    blocks.push({
      createdAt: userRecord.createdAt,
      userInput,
      delivery,
      fileChangePaths: digestRecord.entry.payload.fileChangePaths
        .map((path) => path.trim())
        .filter(Boolean)
    })
  }
  return blocks
}

export const renderSessionBlock = (block: CompletedSessionBlock): string => {
  const lines = [
    formatCatalogTimestamp(block.createdAt),
    `用户：${block.userInput || '无'}`,
    `交付：${block.delivery || '无'}`
  ]
  if (block.fileChangePaths.length > 0) {
    lines.push(`改动文件：${block.fileChangePaths.join(', ')}`)
  }
  return lines.join('\n')
}

const clipSessionBlockToTokens = (block: CompletedSessionBlock, maxTokens: number): string => {
  if (maxTokens < 1) return ''
  const withoutDelivery: CompletedSessionBlock = { ...block, delivery: '' }
  const prefix = renderSessionBlock(withoutDelivery)
  const prefixTokens = estimateTextTokens(prefix)
  if (prefixTokens >= maxTokens) {
    const prefixChars = Math.max(0, maxTokens * 4)
    return prefix.slice(0, prefixChars)
  }
  const deliveryBudgetChars = Math.max(0, (maxTokens - prefixTokens) * 4)
  const clippedDelivery =
    block.delivery.length <= deliveryBudgetChars
      ? block.delivery
      : `${block.delivery.slice(0, Math.max(0, deliveryBudgetChars - 1))}…`
  return renderSessionBlock({ ...block, delivery: clippedDelivery })
}

export const assembleConversationHistory = (
  records: readonly ChatMessageLogRecord[],
  maxTokens: number
): string => {
  if (maxTokens < 1) return ''
  const blocks = collectCompletedSessionBlocks(records)
  if (blocks.length === 0) return ''
  const kept: string[] = []
  let used = 0
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (!block) continue
    const rendered = renderSessionBlock(block)
    const cost = estimateTextTokens(rendered)
    if (kept.length === 0 && cost > maxTokens) {
      const clipped = clipSessionBlockToTokens(block, maxTokens)
      if (clipped) kept.push(clipped)
      break
    }
    if (used + cost > maxTokens) break
    kept.push(rendered)
    used += cost
  }
  return kept.reverse().join('\n\n')
}
