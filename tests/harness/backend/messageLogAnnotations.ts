import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMessageLogRecord } from '../../../src/shared/types'
import type { StorageService } from '../../../src/main/services/storage/StorageService'
import type { TestArtifact } from '../core/run-log-contract'
import { resolveRunArtifactsDir } from '../core/write-run-log'

export const MESSAGE_LOG_ANNOTATION_ARTIFACT_ID = 'message-log-annotations'
export const MESSAGE_LOG_ANNOTATION_FILE_NAME = 'message-log-annotations.json'

export type MessageLogBookmarkSnapshot = {
  partnerId: string
  seq: number
  runId: string
  createdAt: number
  eventType: 'compaction_checkpoint' | 'discard_checkpoint'
  throughSeq: number
  compactBlockId?: string
  sourceMessageCount?: number
  summaryChars?: number
  conversationHistoryChars?: number
}

const isBookmarkRecord = (
  record: ChatMessageLogRecord
): record is ChatMessageLogRecord & {
  entry: Extract<
    ChatMessageLogRecord['entry'],
    { eventType: 'compaction_checkpoint' | 'discard_checkpoint' }
  >
} =>
  record.entry.kind === 'annotation' &&
  (record.entry.eventType === 'compaction_checkpoint' ||
    record.entry.eventType === 'discard_checkpoint')

export const snapshotMessageLogBookmarks = (
  records: readonly ChatMessageLogRecord[]
): MessageLogBookmarkSnapshot[] =>
  records.filter(isBookmarkRecord).map((record) => {
    const payload = record.entry.payload
    if (record.entry.eventType === 'compaction_checkpoint') {
      return {
        partnerId: record.partnerId,
        seq: record.seq,
        runId: record.runId,
        createdAt: record.createdAt,
        eventType: 'compaction_checkpoint',
        throughSeq: payload.throughSeq,
        compactBlockId: payload.compactBlockId,
        sourceMessageCount: payload.sourceMessageCount,
        summaryChars: payload.summary.length
      }
    }
    return {
      partnerId: record.partnerId,
      seq: record.seq,
      runId: record.runId,
      createdAt: record.createdAt,
      eventType: 'discard_checkpoint',
      throughSeq: payload.throughSeq,
      conversationHistoryChars: payload.conversationHistory.length
    }
  })

export const collectMessageLogAnnotationArtifact = async (input: {
  scope: string
  caseId: string
  runId: string
  storageService: StorageService
  partnerIds: readonly string[]
}): Promise<TestArtifact[]> => {
  const partnerIds = [...new Set(input.partnerIds.filter((partnerId) => partnerId.trim()))]
  if (partnerIds.length === 0) return []

  const items = (
    await Promise.all(
      partnerIds.map(async (partnerId) =>
        snapshotMessageLogBookmarks(await input.storageService.chatMessageLog.list(partnerId))
      )
    )
  ).flat()

  const artifactsDir = resolveRunArtifactsDir({
    scope: input.scope,
    caseId: input.caseId,
    runId: input.runId
  })
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(
    path.join(artifactsDir, MESSAGE_LOG_ANNOTATION_FILE_NAME),
    `${JSON.stringify({ partnerIds, items }, null, 2)}\n`,
    'utf8'
  )

  return [
    {
      id: MESSAGE_LOG_ANNOTATION_ARTIFACT_ID,
      kind: 'other',
      path: path.posix.join('artifacts', MESSAGE_LOG_ANNOTATION_FILE_NAME),
      fileName: MESSAGE_LOG_ANNOTATION_FILE_NAME
    }
  ]
}
