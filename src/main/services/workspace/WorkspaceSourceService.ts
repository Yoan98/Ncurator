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

const toWorkspaceName = (rootPath: string, preferredName?: string): string => {
  const trimmed = String(preferredName || '').trim()
  if (trimmed.length > 0) return trimmed
  return path.basename(rootPath) || rootPath
}

const normalizeComparablePath = (value: string): string => {
  const normalized = path.normalize(value)
  const withoutTrailing = normalized.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? withoutTrailing.toLowerCase() : withoutTrailing
}

const isSameOrNestedPath = (candidatePath: string, targetPath: string): boolean => {
  const candidate = normalizeComparablePath(candidatePath)
  const target = normalizeComparablePath(targetPath)
  if (candidate === target) return true
  return candidate.startsWith(`${target}${path.sep}`)
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
    const { normalizedRootPath } = await this.normalizeWorkspaceRoot(input.rootPath)
    const relativePath = String(input.relativePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
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
      throw new Error('工作空间目录不能为空')
    }

    const resolvedPath = path.resolve(requestedPath)
    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory()) {
      throw new Error('工作空间必须是目录')
    }

    const normalizedRootPath = await fs.realpath(resolvedPath)
    return {
      normalizedRootPath,
      displayName: toWorkspaceName(normalizedRootPath)
    }
  }

  public async assertNoNestedWorkspace(
    candidateRootPath: string,
    existingRootPaths: string[]
  ): Promise<void> {
    const candidate = (await this.normalizeWorkspaceRoot(candidateRootPath)).normalizedRootPath
    for (const rootPath of existingRootPaths) {
      const existing = (await this.normalizeWorkspaceRoot(rootPath)).normalizedRootPath
      if (isSameOrNestedPath(candidate, existing) || isSameOrNestedPath(existing, candidate)) {
        throw new Error('工作空间之间不能重复或嵌套')
      }
    }
  }

  public async scanWorkspaceTree(input: {
    workspaceId: string
    rootPath: string
    workspaceName?: string
    now?: number
  }): Promise<WorkspaceTreeScanResult> {
    const { normalizedRootPath, displayName } = await this.normalizeWorkspaceRoot(input.rootPath)
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
    const entries: WorkspaceTreeEntry[] = []

    await this.walkDirectory({
      workspaceId: input.workspaceId,
      rootPath: normalizedRootPath,
      currentPath: normalizedRootPath,
      entries
    })

    return {
      workspace: {
        id: input.workspaceId,
        name: toWorkspaceName(normalizedRootPath, input.workspaceName || displayName),
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

    for (const entry of supportedEntries) {
      const record = recordMap.get(entry.relative_path)
      if (!record) {
        diff.added.push(entry)
        diff.untracked.push(entry)
        continue
      }

      const sameSize = record.size === entry.size
      const sameMtime = record.mtime_ms === entry.mtime_ms
      if (sameSize && sameMtime) {
        diff.unchanged.push({ entry, record })
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
        await this.walkDirectory({
          ...input,
          currentPath: absolutePath
        })
        continue
      }

      if (!entry.isFile()) continue
      const stat = await fs.stat(absolutePath)
      const fileExt = path.extname(entry.name).toLowerCase()
      input.entries.push({
        id: toEntryId(input.workspaceId, 'file', normalizedRelativePath),
        workspace_id: input.workspaceId,
        parent_id: toParentId(input.workspaceId, toParentRelativePath(normalizedRelativePath)),
        kind: 'file',
        name: entry.name,
        relative_path: normalizedRelativePath,
        absolute_path: absolutePath,
        file_ext: fileExt.slice(1) || undefined,
        supported_for_index: isSupportedLocalFilePath(absolutePath),
        size: stat.size,
        mtime_ms: Math.trunc(stat.mtimeMs)
      })
    }
  }
}
