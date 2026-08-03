import type { AiFileChangeRecord, ListAiFileChangeRecordsRequest } from './types'

export type FileChangeRunScope = {
  sessionId: string
  runId: string
}

export const createFileChangeRunScope = (input: FileChangeRunScope): FileChangeRunScope => ({
  sessionId: input.sessionId,
  runId: input.runId
})

export const isCurrentFileChangeRunScope = (
  scope: FileChangeRunScope | null,
  input: FileChangeRunScope
): boolean => scope?.sessionId === input.sessionId && scope.runId === input.runId

export const createFileChangeListRequest = (
  scope: FileChangeRunScope
): ListAiFileChangeRecordsRequest => ({
  sessionId: scope.sessionId,
  runId: scope.runId
})

export const filterFileChangeRecordsForScope = (
  records: readonly AiFileChangeRecord[],
  scope: FileChangeRunScope
): AiFileChangeRecord[] =>
  records.filter((record) => record.sessionId === scope.sessionId && record.runId === scope.runId)

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
