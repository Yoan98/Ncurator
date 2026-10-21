import type { AiFileChangeRecord } from './types'

const INTERNAL_RUNTIME_PATH_PATTERN =
  /(?:^|\/)(?:\.ncurator\/runtime|partners\/[^/]+\/runtime)\/(?:assets|scripts)(?:\/|$)/iu

export const isInternalRuntimePath = (filePath: string | undefined): boolean =>
  Boolean(filePath && INTERNAL_RUNTIME_PATH_PATTERN.test(filePath.replace(/\\/g, '/')))

const isInternalRuntimeFileChange = (record: AiFileChangeRecord): boolean =>
  [record.path, record.beforePath, record.afterPath].some(isInternalRuntimePath)

export const filterVisibleFileChangeRecords = (
  records: readonly AiFileChangeRecord[],
  userAttachmentPaths: readonly string[] = []
): AiFileChangeRecord[] => {
  const preservedPaths = new Set(
    userAttachmentPaths.map((filePath) => filePath.replace(/\\/g, '/'))
  )
  return records.filter(
    (record) =>
      !isInternalRuntimeFileChange(record) ||
      [record.path, record.beforePath, record.afterPath]
        .filter((filePath): filePath is string => Boolean(filePath))
        .some((filePath) => preservedPaths.has(filePath.replace(/\\/g, '/')))
  )
}
