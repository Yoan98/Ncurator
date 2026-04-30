import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { WorkspaceNode, WorkspacePrepareMode } from '../../../shared/types'
import type { WorkspaceNodeDiff, WorkspaceScanResult, WorkspaceValidationResult } from './types'
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

const toNodeId = (workspaceId: string, kind: WorkspaceNode['kind'], relativePath: string): string =>
  `${workspaceId}:${kind}:${relativePath}`

const toParentId = (workspaceId: string, parentRelativePath: string): string | undefined =>
  parentRelativePath ? toNodeId(workspaceId, 'directory', parentRelativePath) : undefined

const toParentRelativePath = (relativePath: string): string => {
  const parentPath = path.posix.dirname(relativePath)
  return parentPath === '.' ? '' : parentPath
}

export class WorkspaceSourceService {
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

  public async scanWorkspace(input: {
    workspaceId: string
    rootPath: string
    workspaceName?: string
    now?: number
  }): Promise<WorkspaceScanResult> {
    const { normalizedRootPath, displayName } = await this.normalizeWorkspaceRoot(input.rootPath)
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
    const nodes: WorkspaceNode[] = []

    await this.walkDirectory({
      workspaceId: input.workspaceId,
      rootPath: normalizedRootPath,
      currentPath: normalizedRootPath,
      now,
      nodes
    })

    return {
      workspace: {
        id: input.workspaceId,
        name: toWorkspaceName(normalizedRootPath, input.workspaceName || displayName),
        root_path: normalizedRootPath,
        status: 'not_prepared',
        last_scan_at: now,
        created_at: now,
        updated_at: now
      },
      nodes
    }
  }

  public async diffWorkspaceNodes(input: {
    existingNodes: WorkspaceNode[]
    nextNodes: WorkspaceNode[]
    mode: WorkspacePrepareMode
  }): Promise<WorkspaceNodeDiff> {
    const existingMap = new Map(input.existingNodes.map((node) => [node.relative_path, node]))
    const nextMap = new Map(input.nextNodes.map((node) => [node.relative_path, node]))

    const diff: WorkspaceNodeDiff = {
      added: [],
      removed: [],
      changed: [],
      unchanged: []
    }

    for (const nextNode of input.nextNodes) {
      const existingNode = existingMap.get(nextNode.relative_path)
      if (!existingNode || existingNode.kind !== nextNode.kind) {
        diff.added.push(nextNode)
        continue
      }

      const changed = await this.hasNodeChanged(existingNode, nextNode)
      if (changed) {
        diff.changed.push(nextNode)
      } else {
        diff.unchanged.push(nextNode)
      }
    }

    for (const existingNode of input.existingNodes) {
      const nextNode = nextMap.get(existingNode.relative_path)
      if (!nextNode || nextNode.kind !== existingNode.kind) {
        diff.removed.push(existingNode)
      }
    }

    return this.filterDiffByMode(diff, input.mode)
  }

  public async computeContentHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath)
    return crypto.createHash('sha1').update(fileBuffer).digest('hex')
  }

  private async walkDirectory(input: {
    workspaceId: string
    rootPath: string
    currentPath: string
    now: number
    nodes: WorkspaceNode[]
  }): Promise<void> {
    const dirEntries = await fs.readdir(input.currentPath, { withFileTypes: true })
    const sortedEntries = [...dirEntries].sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of sortedEntries) {
      const absolutePath = path.join(input.currentPath, entry.name)
      const relativePath = path.relative(input.rootPath, absolutePath)
      const normalizedRelativePath = relativePath.split(path.sep).join('/')
      if (!normalizedRelativePath) continue

      if (entry.isDirectory()) {
        input.nodes.push({
          id: toNodeId(input.workspaceId, 'directory', normalizedRelativePath),
          workspace_id: input.workspaceId,
          parent_id: toParentId(input.workspaceId, toParentRelativePath(normalizedRelativePath)),
          kind: 'directory',
          name: entry.name,
          relative_path: normalizedRelativePath,
          absolute_path: absolutePath,
          exists: true,
          prepare_status: 'not_prepared',
          created_at: input.now,
          updated_at: input.now
        })
        await this.walkDirectory({
          ...input,
          currentPath: absolutePath
        })
        continue
      }

      if (!entry.isFile()) continue
      const fileExt = path.extname(entry.name).toLowerCase()
      if (!isSupportedLocalFilePath(absolutePath)) continue

      const stat = await fs.stat(absolutePath)
      input.nodes.push({
        id: toNodeId(input.workspaceId, 'file', normalizedRelativePath),
        workspace_id: input.workspaceId,
        parent_id: toParentId(input.workspaceId, toParentRelativePath(normalizedRelativePath)),
        kind: 'file',
        name: entry.name,
        relative_path: normalizedRelativePath,
        absolute_path: absolutePath,
        file_ext: fileExt.slice(1),
        exists: true,
        size: stat.size,
        mtime_ms: stat.mtimeMs,
        prepare_status: 'not_prepared',
        created_at: input.now,
        updated_at: input.now
      })
    }
  }

  private async hasNodeChanged(existingNode: WorkspaceNode, nextNode: WorkspaceNode): Promise<boolean> {
    if (existingNode.kind !== nextNode.kind) return true
    if (existingNode.kind === 'directory') return false

    const sameSize = existingNode.size === nextNode.size
    const sameMtime = existingNode.mtime_ms === nextNode.mtime_ms
    if (sameSize && sameMtime) return false

    const nextHash = await this.getOrCreateContentHash(nextNode)
    nextNode.content_hash = nextHash
    const existingHash = existingNode.content_hash
    if (!existingHash) return true
    return nextHash !== existingHash
  }

  private async getOrCreateContentHash(node: WorkspaceNode): Promise<string> {
    if (node.content_hash) return node.content_hash
    return this.computeContentHash(node.absolute_path)
  }

  private filterDiffByMode(diff: WorkspaceNodeDiff, mode: WorkspacePrepareMode): WorkspaceNodeDiff {
    switch (mode) {
      case 'presence_only':
        return {
          ...diff,
          changed: [],
          unchanged: [...diff.unchanged, ...diff.changed]
        }
      case 'changes_only':
        return {
          ...diff,
          added: [],
          removed: [],
          unchanged: [...diff.unchanged, ...diff.added, ...diff.removed]
        }
      default:
        return diff
    }
  }
}
