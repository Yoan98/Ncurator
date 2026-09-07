import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { WorkspaceFileIndexRecord, WorkspaceTreeEntry } from '../../../shared/types'
import type {
  WorkspaceTreeEntryDiff,
  WorkspaceTreeScanResult,
  WorkspaceValidationResult
} from './types'
import { isSupportedLocalFilePath } from '../ingestion/loader'

const toWorkspaceName = (rootPath: string): string => path.basename(rootPath) || rootPath

const normalizeComparablePath = (value: string): string => {
  const normalized = path.normalize(value)
  const withoutTrailing = normalized.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? withoutTrailing.toLowerCase() : withoutTrailing
}

const isSamePath = (leftPath: string, rightPath: string): boolean =>
  normalizeComparablePath(leftPath) === normalizeComparablePath(rightPath)

/** True when candidate is the same as target, or a path strictly inside target. */
const isSameOrNestedPath = (candidatePath: string, targetPath: string): boolean => {
  const candidate = normalizeComparablePath(candidatePath)
  const target = normalizeComparablePath(targetPath)
  if (candidate === target) return true
  const relative = path.relative(target, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const toEntryId = (
  workspaceId: string,
  kind: WorkspaceTreeEntry['kind'],
  relativePath: string
): string => `${workspaceId}:${kind}:${relativePath}`

const toParentId = (workspaceId: string, parentRelativePath: string): string | undefined =>
  parentRelativePath ? toEntryId(workspaceId, 'directory', parentRelativePath) : undefined

const toParentRelativePath = (relativePath: string): string => {
  const parentPath = path.posix.dirname(relativePath)
  return parentPath === '.' ? '' : parentPath
}

const toFileIndexId = (workspaceId: string, relativePath: string): string =>
  crypto.createHash('sha1').update(`${workspaceId}:${relativePath}`).digest('hex')

const isVisiblePath = (relativePath: string): boolean =>
  !relativePath
    .split('/')
    .filter(Boolean)
    .some((segment) => segment.startsWith('.'))

const isVisibleName = (name: string): boolean => !name.startsWith('.')

export class WorkspaceSourceService {
  public async listDirectory(input: {
    workspaceId: string
    rootPath: string
    relativePath?: string
  }): Promise<WorkspaceTreeEntry[]> {
    const { normalizedRootPath, kind } = await this.normalizeWorkspaceRoot(input.rootPath)
    const relativePath = String(input.relativePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
    if (kind === 'file') {
      if (relativePath) throw new Error('文件地址没有子目录')
      return []
    }
    const currentPath = path.resolve(normalizedRootPath, relativePath)
    if (!isSameOrNestedPath(currentPath, normalizedRootPath)) {
      throw new Error('目录不在当前工作区内')
    }
    const dirEntries = await fs.readdir(currentPath, { withFileTypes: true })
    const visible = dirEntries
      .filter((entry) => isVisibleName(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name)
      })
    const entries: WorkspaceTreeEntry[] = []
    for (const entry of visible) {
      if (!entry.isDirectory() && !entry.isFile()) continue
      const childRelativePath = [relativePath, entry.name].filter(Boolean).join('/')
      const absolutePath = path.join(currentPath, entry.name)
      const supportedForIndex = entry.isFile() && isSupportedLocalFilePath(absolutePath)
      const base = {
        id: toEntryId(
          input.workspaceId,
          entry.isDirectory() ? 'directory' : 'file',
          childRelativePath
        ),
        workspace_id: input.workspaceId,
        parent_id: toParentId(input.workspaceId, relativePath),
        kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        name: entry.name,
        relative_path: childRelativePath,
        absolute_path: absolutePath,
        supported_for_index: supportedForIndex
      }
      if (entry.isDirectory()) {
        entries.push(base)
        continue
      }
      if (!supportedForIndex) {
        entries.push({
          ...base,
          file_ext: path.extname(entry.name).toLowerCase().slice(1) || undefined
        })
        continue
      }
      const stat = await fs.stat(absolutePath)
      const fileExt = path.extname(entry.name).toLowerCase()
      entries.push({
        ...base,
        file_ext: fileExt.slice(1) || undefined,
        size: stat.size,
        mtime_ms: Math.trunc(stat.mtimeMs)
      })
    }
    return entries
  }

  public async normalizeWorkspaceRoot(inputPath: string): Promise<WorkspaceValidationResult> {
    const requestedPath = String(inputPath || '').trim()
    if (!requestedPath) {
      throw new Error('工作空间地址不能为空')
    }

    const resolvedPath = path.resolve(requestedPath)
    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory() && !stat.isFile()) {
      throw new Error('工作空间必须是目录或文件')
    }

    const normalizedRootPath = await fs.realpath(resolvedPath)
    return {
      normalizedRootPath,
      displayName: toWorkspaceName(normalizedRootPath),
      kind: stat.isDirectory() ? 'directory' : 'file'
    }
  }

  public async classifyCandidateRoot(
    candidateRootPath: string,
    existingRootPaths: string[]
  ): Promise<{
    normalizedRootPath: string
    displayName: string
    sameAsExisting: boolean
    nestedUnderExisting: boolean
    nestedUnderExistingRootPaths: string[]
    containedExistingRootPaths: string[]
  }> {
    const { normalizedRootPath, displayName } = await this.normalizeWorkspaceRoot(candidateRootPath)
    let sameAsExisting = false
    const nestedUnderExistingRootPaths: string[] = []
    const containedExistingRootPaths: string[] = []
    for (const rootPath of existingRootPaths) {
      const existingRaw = String(rootPath || '').trim()
      if (!existingRaw) continue
      let existingNormalized = existingRaw
      try {
        existingNormalized = (await this.normalizeWorkspaceRoot(existingRaw)).normalizedRootPath
      } catch {
        existingNormalized = path.resolve(existingRaw)
      }
      if (isSamePath(normalizedRootPath, existingNormalized)) {
        sameAsExisting = true
        continue
      }
      if (isSameOrNestedPath(normalizedRootPath, existingNormalized)) {
        nestedUnderExistingRootPaths.push(existingNormalized)
      } else if (isSameOrNestedPath(existingNormalized, normalizedRootPath)) {
        containedExistingRootPaths.push(existingNormalized)
      }
    }
    return {
      normalizedRootPath,
      displayName,
      sameAsExisting,
      nestedUnderExisting: nestedUnderExistingRootPaths.length > 0,
      nestedUnderExistingRootPaths,
      containedExistingRootPaths
    }
  }

  public async scanWorkspaceTree(input: {
    workspaceId: string
    rootPath: string
    now?: number
    onProgress?: (progress: {
      scannedEntryCount: number
      supportedFileCount: number
    }) => void | Promise<void>
  }): Promise<WorkspaceTreeScanResult> {
    const { normalizedRootPath, kind } = await this.normalizeWorkspaceRoot(input.rootPath)
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
    const entries: WorkspaceTreeEntry[] = []

    if (kind === 'file') {
      const name = path.basename(normalizedRootPath)
      const stat = await fs.stat(normalizedRootPath)
      const fileExt = path.extname(name).toLowerCase()
      const supportedForIndex = isSupportedLocalFilePath(normalizedRootPath)
      entries.push({
        id: toEntryId(input.workspaceId, 'file', name),
        workspace_id: input.workspaceId,
        kind: 'file',
        name,
        relative_path: name,
        absolute_path: normalizedRootPath,
        file_ext: fileExt.slice(1) || undefined,
        supported_for_index: supportedForIndex,
        size: stat.size,
        mtime_ms: Math.trunc(stat.mtimeMs)
      })
      await input.onProgress?.({
        scannedEntryCount: 1,
        supportedFileCount: supportedForIndex ? 1 : 0
      })
    } else {
      await this.walkDirectory({
        workspaceId: input.workspaceId,
        rootPath: normalizedRootPath,
        currentPath: normalizedRootPath,
        entries,
        progress: {
          scannedEntryCount: 0,
          supportedFileCount: 0
        },
        onProgress: input.onProgress
      })
    }

    return {
      workspace: {
        id: input.workspaceId,
        root_path: normalizedRootPath,
        created_at: now,
        updated_at: now
      },
      entries
    }
  }

  public async computeContentHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath)
    return crypto.createHash('sha1').update(fileBuffer).digest('hex')
  }

  public async diffWorkspaceTreeAgainstIndex(input: {
    entries: WorkspaceTreeEntry[]
    records: WorkspaceFileIndexRecord[]
    onProgress?: (progress: { processedCount: number; totalCount: number }) => void | Promise<void>
  }): Promise<WorkspaceTreeEntryDiff> {
    const supportedEntries = input.entries.filter(
      (entry) => entry.kind === 'file' && entry.supported_for_index
    )
    const entryMap = new Map(supportedEntries.map((entry) => [entry.relative_path, entry] as const))
    const recordMap = new Map(
      input.records.map((record) => [record.relative_path, record] as const)
    )

    const diff: WorkspaceTreeEntryDiff = {
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
      untracked: []
    }

    let processedCount = 0
    for (const entry of supportedEntries) {
      const record = recordMap.get(entry.relative_path)
      if (!record) {
        diff.added.push(entry)
        diff.untracked.push(entry)
        processedCount += 1
        await input.onProgress?.({ processedCount, totalCount: supportedEntries.length })
        continue
      }

      const sameSize = record.size === entry.size
      const sameMtime = record.mtime_ms === entry.mtime_ms
      if (sameSize && sameMtime) {
        diff.unchanged.push({ entry, record })
        processedCount += 1
        await input.onProgress?.({ processedCount, totalCount: supportedEntries.length })
        continue
      }

      const currentHash = await this.computeContentHash(entry.absolute_path)
      if (record.content_hash && record.content_hash === currentHash) {
        diff.unchanged.push({
          entry: {
            ...entry
          },
          record: {
            ...record,
            content_hash: currentHash
          }
        })
        continue
      }

      diff.changed.push({
        entry,
        record: {
          ...record,
          content_hash: currentHash
        }
      })
      processedCount += 1
      await input.onProgress?.({ processedCount, totalCount: supportedEntries.length })
    }

    for (const record of input.records) {
      if (!entryMap.has(record.relative_path)) {
        diff.removed.push(record)
      }
    }

    return diff
  }

  public buildWorkspaceFileIndexRecord(input: {
    workspaceId: string
    entry: WorkspaceTreeEntry
    now: number
    previous?: WorkspaceFileIndexRecord
  }): WorkspaceFileIndexRecord {
    return {
      id: input.previous?.id || toFileIndexId(input.workspaceId, input.entry.relative_path),
      workspace_id: input.workspaceId,
      relative_path: input.entry.relative_path,
      absolute_path: input.entry.absolute_path,
      name: input.entry.name,
      file_ext: input.entry.file_ext || '',
      size: input.entry.size,
      mtime_ms: input.entry.mtime_ms,
      content_hash: input.previous?.content_hash,
      index_status: input.previous?.index_status || 'needs_index',
      document_id: input.previous?.document_id,
      indexed_at: input.previous?.indexed_at,
      last_checked_at: input.now,
      last_error: input.previous?.last_error,
      created_at: input.previous?.created_at || input.now,
      updated_at: input.now
    }
  }

  public mergeTreeWithIndex(input: {
    entries: WorkspaceTreeEntry[]
    records: WorkspaceFileIndexRecord[]
  }): WorkspaceTreeEntry[] {
    const recordMap = new Map(
      input.records.map((record) => [record.relative_path, record] as const)
    )
    return input.entries
      .filter((entry) => isVisiblePath(entry.relative_path))
      .map((entry) => {
        if (entry.kind !== 'file' || !entry.supported_for_index) {
          return entry
        }
        const record = recordMap.get(entry.relative_path)
        if (!record) return entry
        return {
          ...entry,
          index_status: record.index_status,
          document_id: record.document_id,
          indexed_at: record.indexed_at,
          last_error: record.last_error
        }
      })
  }

  private async walkDirectory(input: {
    workspaceId: string
    rootPath: string
    currentPath: string
    entries: WorkspaceTreeEntry[]
    progress: {
      scannedEntryCount: number
      supportedFileCount: number
    }
    onProgress?: (progress: {
      scannedEntryCount: number
      supportedFileCount: number
    }) => void | Promise<void>
  }): Promise<void> {
    const dirEntries = await fs.readdir(input.currentPath, { withFileTypes: true })
    const sortedEntries = [...dirEntries].sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of sortedEntries) {
      const absolutePath = path.join(input.currentPath, entry.name)
      const relativePath = path.relative(input.rootPath, absolutePath)
      const normalizedRelativePath = relativePath.split(path.sep).join('/')
      if (!normalizedRelativePath) continue
      if (!isVisiblePath(normalizedRelativePath)) continue

      if (entry.isDirectory()) {
        input.entries.push({
          id: toEntryId(input.workspaceId, 'directory', normalizedRelativePath),
          workspace_id: input.workspaceId,
          parent_id: toParentId(input.workspaceId, toParentRelativePath(normalizedRelativePath)),
          kind: 'directory',
          name: entry.name,
          relative_path: normalizedRelativePath,
          absolute_path: absolutePath,
          supported_for_index: false
        })
        input.progress.scannedEntryCount += 1
        await input.onProgress?.(input.progress)
        await this.walkDirectory({
          ...input,
          currentPath: absolutePath
        })
        continue
      }

      if (!entry.isFile()) continue
      const stat = await fs.stat(absolutePath)
      const fileExt = path.extname(entry.name).toLowerCase()
      const supportedForIndex = isSupportedLocalFilePath(absolutePath)
      input.entries.push({
        id: toEntryId(input.workspaceId, 'file', normalizedRelativePath),
        workspace_id: input.workspaceId,
        parent_id: toParentId(input.workspaceId, toParentRelativePath(normalizedRelativePath)),
        kind: 'file',
        name: entry.name,
        relative_path: normalizedRelativePath,
        absolute_path: absolutePath,
        file_ext: fileExt.slice(1) || undefined,
        supported_for_index: supportedForIndex,
        size: stat.size,
        mtime_ms: Math.trunc(stat.mtimeMs)
      })
      input.progress.scannedEntryCount += 1
      if (supportedForIndex) input.progress.supportedFileCount += 1
      await input.onProgress?.(input.progress)
    }
  }
}
