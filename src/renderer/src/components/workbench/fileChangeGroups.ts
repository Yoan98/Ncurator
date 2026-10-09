import type { AiFileChangeRecord } from '../../../../shared/types'

export type SessionFileChangeGroup = {
  latest: AiFileChangeRecord
  records: AiFileChangeRecord[]
  paths: Set<string>
}

export const normalizeFileChangePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()

export const findLatestFileChangeForPath = (
  records: readonly AiFileChangeRecord[],
  filePath: string
): AiFileChangeRecord | null => {
  const path = normalizeFileChangePath(filePath)
  return (
    records
      .filter(
        (record) =>
          record.status === 'applied' &&
          normalizeFileChangePath(record.afterPath || record.path) === path
      )
      .sort((left, right) => right.createdAt - left.createdAt)[0] || null
  )
}

export const groupSessionFileChanges = (
  changeRecords: readonly AiFileChangeRecord[]
): SessionFileChangeGroup[] => {
  const groups: Array<{ records: AiFileChangeRecord[]; paths: Set<string> }> = []
  const records = [...changeRecords]
    .filter((record) => record.status === 'applied')
    .sort((left, right) => left.updatedAt - right.updatedAt)

  for (const record of records) {
    const recordPaths = new Set(
      [record.path, record.beforePath, record.afterPath]
        .filter((value): value is string => Boolean(value))
        .map(normalizeFileChangePath)
    )
    const matches = groups.filter((group) =>
      [...recordPaths].some((value) => group.paths.has(value))
    )
    if (matches.length === 0) {
      groups.push({ records: [record], paths: recordPaths })
      continue
    }
    const target = matches[0]!
    target.records.push(record)
    recordPaths.forEach((value) => target.paths.add(value))
    for (const extra of matches.slice(1)) {
      extra.records.forEach((item) => target.records.push(item))
      extra.paths.forEach((value) => target.paths.add(value))
      groups.splice(groups.indexOf(extra), 1)
    }
  }

  return groups
    .map((group) => {
      const sorted = group.records.sort((left, right) => right.updatedAt - left.updatedAt)
      return { latest: sorted[0]!, records: sorted, paths: group.paths }
    })
    .filter((group) => {
      const earliest = group.records[group.records.length - 1]!
      if (earliest.operation === 'created' && group.latest.operation === 'deleted') return false
      return !(
        group.latest.afterObjectHash &&
        earliest.beforeObjectHash &&
        group.latest.afterObjectHash === earliest.beforeObjectHash
      )
    })
    .sort((left, right) => right.latest.updatedAt - left.latest.updatedAt)
}
