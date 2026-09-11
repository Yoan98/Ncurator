import type { AiFileChangeRecord, ListAiFileChangeRecordsRequest } from './types'

export type FileChangeRunScope = {
  partnerId: string
  runId: string
}

export const createFileChangeRunScope = (input: FileChangeRunScope): FileChangeRunScope => ({
  partnerId: input.partnerId,
  runId: input.runId
})

export const isCurrentFileChangeRunScope = (
  scope: FileChangeRunScope | null,
  input: FileChangeRunScope
): boolean => scope?.partnerId === input.partnerId && scope.runId === input.runId

export const createFileChangeListRequest = (
  scope: FileChangeRunScope
): ListAiFileChangeRecordsRequest => ({
  partnerId: scope.partnerId,
  runId: scope.runId
})

export const filterFileChangeRecordsForScope = (
  records: readonly AiFileChangeRecord[],
  scope: FileChangeRunScope
): AiFileChangeRecord[] =>
  records.filter((record) => record.partnerId === scope.partnerId && record.runId === scope.runId)

export const groupFileChangeRecordsByRun = (
  records: readonly AiFileChangeRecord[]
): Map<string, AiFileChangeRecord[]> => {
  const grouped = new Map<string, AiFileChangeRecord[]>()
  records.forEach((record) => {
    const current = grouped.get(record.runId) || []
    current.push(record)
    grouped.set(record.runId, current)
  })
  return grouped
}
