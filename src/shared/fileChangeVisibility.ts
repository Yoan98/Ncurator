import type { AiFileChangeRecord } from './types'

const RUNTIME_ASSET_PATH_PATTERN = /(?:^|\/)\.ncurator\/runtime\/assets(?:\/|$)/iu

export const isRuntimeAssetPath = (filePath: string | undefined): boolean =>
  Boolean(filePath && RUNTIME_ASSET_PATH_PATTERN.test(filePath.replace(/\\/g, '/')))

export const isRuntimeAssetFileChange = (record: AiFileChangeRecord): boolean =>
  [record.path, record.beforePath, record.afterPath].some(isRuntimeAssetPath)

export const filterVisibleFileChangeRecords = (
  records: readonly AiFileChangeRecord[]
): AiFileChangeRecord[] => records.filter((record) => !isRuntimeAssetFileChange(record))
