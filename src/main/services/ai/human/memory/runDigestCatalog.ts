import type {
  ChatMessageLogRecord,
  ChatMessageLogUserContext,
  RunDigestStatus
} from '../../../../../shared/types'
import { estimateTextTokens } from '../utils/tokenEstimate'
import { buildReferenceScope, renderCompactReferenceScope } from '../prompts/referenceScope'
import { orderMessageLogBySeq, resolveLastConversationRunId } from './transcript'

export const FAILED_RUN_DELIVERY_TEXT = '运行失败，没有交付'
export const DIGEST_UNAVAILABLE_FALLBACK = '已有交付，但摘要未生成'

export type RunDigestCatalogEntry = {
  createdAt: number
  summary: string
  fileChangePaths: string[]
  compactReferences: string
}

export type ConversationHistoryBlock = {
  createdAt: number
  userInput: string
  compactReferences: string
  delivery: string
  fileChangePaths: string[]
  kind: 'completed' | 'failed'
}

export type SessionRunSlice = {
  runId: string
  createdAt: number
  userInput: string
  compactReferences: string
  delivery: string
  fileChangePaths: string[]
  digestStatus: RunDigestStatus | 'none'
  digestSummary: string
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export const formatCatalogTimestamp = (createdAt: number): string => {
  const date = new Date(createdAt)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

const isDeliveryAssistant = (record: ChatMessageLogRecord): boolean =>
  record.entry.kind === 'assistant' && record.entry.toolCalls.length === 0

const isRunDigestRecord = (
  record: ChatMessageLogRecord
): record is ChatMessageLogRecord & {
  entry: Extract<ChatMessageLogRecord['entry'], { eventType: 'run_digest' }>
} => record.entry.kind === 'annotation' && record.entry.eventType === 'run_digest'

export const resolveRunDigestStatus = (payload?: {
  status?: RunDigestStatus
  summary?: string
}): RunDigestStatus | 'none' => {
  if (!payload) return 'none'
  if (payload.status === 'pending' || payload.status === 'completed' || payload.status === 'failed') {
    return payload.status
  }
  return payload.summary?.trim() ? 'completed' : 'none'
}

const compactReferencesFromContext = (context: ChatMessageLogUserContext): string =>
  renderCompactReferenceScope(
    buildReferenceScope({
      selectedReferences: context.selectedReferences,
      attachments: context.attachments
    })
  )

export const collectSessionRunSlices = (
  records: readonly ChatMessageLogRecord[]
): SessionRunSlice[] => {
  const ordered = orderMessageLogBySeq([...records])
  const groups = new Map<string, ChatMessageLogRecord[]>()
  const runOrder: string[] = []
  for (const record of ordered) {
    const existing = groups.get(record.runId)
    if (!existing) {
      runOrder.push(record.runId)
      groups.set(record.runId, [record])
      continue
    }
    existing.push(record)
  }

  return runOrder.map((runId) => {
    const group = groups.get(runId) || []
    const userRecord = group.find(
      (record) => record.entry.kind === 'user' && record.entry.input.trim()
    )
    const deliveryRecord = [...group].reverse().find(isDeliveryAssistant)
    const digestRecord = [...group].reverse().find(isRunDigestRecord)
    const digestPayload = digestRecord?.entry.payload
    const userInput = userRecord?.entry.kind === 'user' ? userRecord.entry.input.trim() : ''
    const delivery =
      deliveryRecord?.entry.kind === 'assistant' ? deliveryRecord.entry.content.trim() : ''
    return {
      runId,
      createdAt: userRecord?.createdAt ?? group[0]?.createdAt ?? 0,
      userInput,
      compactReferences:
        userRecord?.entry.kind === 'user' ? compactReferencesFromContext(userRecord.entry.context) : '',
      delivery,
      fileChangePaths: (digestPayload?.fileChangePaths || []).map((path) => path.trim()).filter(Boolean),
      digestStatus: resolveRunDigestStatus(digestPayload),
      digestSummary: digestPayload?.summary.trim() || ''
    }
  })
}

export const collectRunDigests = (
  records: readonly ChatMessageLogRecord[]
): RunDigestCatalogEntry[] => {
  const entries: RunDigestCatalogEntry[] = []
  for (const slice of collectSessionRunSlices(records)) {
    if (!slice.userInput || !slice.delivery) continue
    if (slice.digestStatus === 'completed' && slice.digestSummary) {
      entries.push({
        createdAt: slice.createdAt,
        summary: slice.digestSummary,
        fileChangePaths: slice.fileChangePaths,
        compactReferences: slice.compactReferences
      })
      continue
    }
    entries.push({
      createdAt: slice.createdAt,
      summary: `${slice.userInput} | ${DIGEST_UNAVAILABLE_FALLBACK}`,
      fileChangePaths: slice.fileChangePaths,
      compactReferences: slice.compactReferences
    })
  }
  return entries
}

export const renderRunDigests = (entries: readonly RunDigestCatalogEntry[]): string =>
  entries
    .map((entry) => {
      const parts = [formatCatalogTimestamp(entry.createdAt), entry.summary]
      if (entry.compactReferences) parts.push(`参考：${entry.compactReferences}`)
      if (entry.fileChangePaths.length > 0) {
        parts.push(`改动文件：${entry.fileChangePaths.join(', ')}`)
      }
      return parts.join(' | ')
    })
    .join('\n')

export const collectConversationHistoryBlocks = (
  records: readonly ChatMessageLogRecord[]
): ConversationHistoryBlock[] => {
  const lastConversationRunId = resolveLastConversationRunId(records)
  const blocks: ConversationHistoryBlock[] = []
  for (const slice of collectSessionRunSlices(records)) {
    if (!slice.userInput) continue
    if (slice.delivery) {
      blocks.push({
        createdAt: slice.createdAt,
        userInput: slice.userInput,
        compactReferences: slice.compactReferences,
        delivery: slice.delivery,
        fileChangePaths: slice.fileChangePaths,
        kind: 'completed'
      })
      continue
    }
    if (slice.runId === lastConversationRunId) continue
    blocks.push({
      createdAt: slice.createdAt,
      userInput: slice.userInput,
      compactReferences: slice.compactReferences,
      delivery: FAILED_RUN_DELIVERY_TEXT,
      fileChangePaths: slice.fileChangePaths,
      kind: 'failed'
    })
  }
  return blocks
}

/** @deprecated 使用 collectConversationHistoryBlocks */
export const collectCompletedSessionBlocks = collectConversationHistoryBlocks

export const renderSessionBlock = (block: ConversationHistoryBlock): string => {
  const lines = [formatCatalogTimestamp(block.createdAt), `用户：${block.userInput || '无'}`]
  if (block.compactReferences) lines.push(`参考：${block.compactReferences}`)
  lines.push(`交付：${block.delivery || '无'}`)
  if (block.fileChangePaths.length > 0) {
    lines.push(`改动文件：${block.fileChangePaths.join(', ')}`)
  }
  return lines.join('\n')
}

const clipSessionBlockToTokens = (block: ConversationHistoryBlock, maxTokens: number): string => {
  if (maxTokens < 1) return ''
  const withoutDelivery: ConversationHistoryBlock = { ...block, delivery: '' }
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
  const blocks = collectConversationHistoryBlocks(records)
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
