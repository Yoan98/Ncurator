import type { AiFileChangeRecord } from './types'

const RUNTIME_ASSET_PATH_PATTERN = /(?:^|\/)\.ncurator\/runtime\/assets(?:\/|$)/iu

export const isRuntimeAssetPath = (filePath: string | undefined): boolean =>
  Boolean(filePath && RUNTIME_ASSET_PATH_PATTERN.test(filePath.replace(/\\/g, '/')))

export const isRuntimeAssetFileChange = (record: AiFileChangeRecord): boolean =>
  [record.path, record.beforePath, record.afterPath].some(isRuntimeAssetPath)

export const filterVisibleFileChangeRecords = (
  records: readonly AiFileChangeRecord[],
  userAttachmentPaths: readonly string[] = []
): AiFileChangeRecord[] => {
  const preservedPaths = new Set(
    userAttachmentPaths.map((filePath) => filePath.replace(/\\/g, '/'))
  )
  return records.filter(
    (record) =>
      !isRuntimeAssetFileChange(record) ||
      [record.path, record.beforePath, record.afterPath]
        .filter((filePath): filePath is string => Boolean(filePath))
        .some((filePath) => preservedPaths.has(filePath.replace(/\\/g, '/')))
  )
}
