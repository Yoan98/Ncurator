import type { ChatMessageLogRecord } from '../../../../../shared/types'
import { RUN_DIGEST_MAX_ENTRIES, RUN_DIGEST_MAX_FILE_PATHS } from '../constants'
import { orderMessageLogBySeq } from './transcript'

export type RunDigestCatalogEntry = {
  createdAt: number
  summary: string
  filePaths: string[]
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export const formatCatalogTimestamp = (createdAt: number): string => {
  const date = new Date(createdAt)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export const collectRunDigestCatalogEntries = (
  records: readonly ChatMessageLogRecord[],
  maxEntries = RUN_DIGEST_MAX_ENTRIES
): RunDigestCatalogEntry[] => {
  const entries: RunDigestCatalogEntry[] = []
  for (const record of orderMessageLogBySeq([...records])) {
    if (record.entry.kind !== 'annotation' || record.entry.eventType !== 'run_digest') continue
    const summary = record.entry.payload.summary.trim()
    if (!summary) continue
    entries.push({
      createdAt: record.createdAt,
      summary,
      filePaths: record.entry.payload.filePaths
        .map((path) => path.trim())
        .filter(Boolean)
        .slice(0, RUN_DIGEST_MAX_FILE_PATHS)
    })
  }
  if (maxEntries < 1) return []
  return entries.slice(-maxEntries)
}

export const renderRunDigestCatalog = (entries: readonly RunDigestCatalogEntry[]): string =>
  entries
    .map((entry) => {
      const time = formatCatalogTimestamp(entry.createdAt)
      const paths = entry.filePaths.join(', ')
      return paths ? `${time} | ${entry.summary} | ${paths}` : `${time} | ${entry.summary}`
    })
    .join('\n')
