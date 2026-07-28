import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type {
  AiFileChangeCapability,
  AiFileChangeOperation,
  AiFileChangeRecord
} from '../../../../shared/types'

const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.ncurator', 'node_modules'])

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.conf',
  '.cpp',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
])

const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xltx', '.xltm'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

type WorkspaceObject = {
  relativePath: string
  absolutePath: string
  objectPath: string
  hash: string
  size: number
  mode: number
}

type TrackedRun = {
  runId: string
  sessionId: string
  workspaceRootPath: string
  runSummary: string
  baseline: Map<string, WorkspaceObject>
}

export type CompletedWorkspaceChange = {
  record: AiFileChangeRecord
  discoveredByScan: boolean
}

const normalizePathKey = (value: string): string =>
  path.resolve(value).replace(/\\/g, '/').toLowerCase()

const hashFile = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

export class WorkspaceObjectStore {
  public constructor(private readonly workspaceRootPath: string) {}

  public getObjectPath(hash: string): string {
    return path.join(
      this.workspaceRootPath,
      '.ncurator',
      'objects',
      'sha256',
      hash.slice(0, 2),
      hash.slice(2)
    )
  }

  public async putFile(filePath: string): Promise<{ hash: string; objectPath: string }> {
    const hash = await hashFile(filePath)
    const objectPath = this.getObjectPath(hash)
    try {
      await fsPromises.access(objectPath)
      return { hash, objectPath }
    } catch {
      // Continue with an atomic content-addressed write.
    }

    await fsPromises.mkdir(path.dirname(objectPath), { recursive: true })
    const tempPath = `${objectPath}.${randomUUID()}.tmp`
    try {
      await fsPromises.copyFile(filePath, tempPath)
      await fsPromises.rename(tempPath, objectPath).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    } finally {
      await fsPromises.rm(tempPath, { force: true }).catch(() => undefined)
    }
    return { hash, objectPath }
  }

  public async putBuffer(content: Buffer): Promise<{ hash: string; objectPath: string }> {
    const hash = createHash('sha256').update(content).digest('hex')
    const objectPath = this.getObjectPath(hash)
    try {
      await fsPromises.access(objectPath)
      return { hash, objectPath }
    } catch {
      await fsPromises.mkdir(path.dirname(objectPath), { recursive: true })
      await fsPromises
        .writeFile(objectPath, content, { flag: 'wx' })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error
        })
      return { hash, objectPath }
    }
  }
}

const scanWorkspace = async (workspaceRootPath: string): Promise<Map<string, WorkspaceObject>> => {
  const objectStore = new WorkspaceObjectStore(workspaceRootPath)
  const result = new Map<string, WorkspaceObject>()

  const visit = async (directoryPath: string, relativeDirectory: string): Promise<void> => {
    const entries = await fsPromises.readdir(directoryPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name
      const absolutePath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stats = await fsPromises.stat(absolutePath)
        const object = await objectStore.putFile(absolutePath)
        result.set(relativePath.replace(/\\/g, '/'), {
          relativePath: relativePath.replace(/\\/g, '/'),
          absolutePath,
          objectPath: object.objectPath,
          hash: object.hash,
          size: stats.size,
          mode: stats.mode
        })
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : ''
        if (code !== 'ENOENT' && code !== 'EACCES' && code !== 'EPERM') throw error
      }
    }
  }

  await visit(workspaceRootPath, '')
  return result
}

const inferCapability = (
  before: WorkspaceObject | undefined,
  after: WorkspaceObject | undefined,
  specialist: AiFileChangeRecord | undefined
): AiFileChangeCapability => {
  if (specialist) return specialist.capability
  const extension = path.extname(after?.absolutePath || before?.absolutePath || '').toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) return 'text_file'
  if (EXCEL_EXTENSIONS.has(extension)) return 'excel'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  return 'terminal_exec'
}

const pairRenames = (
  deleted: WorkspaceObject[],
  created: WorkspaceObject[]
): Array<{ before: WorkspaceObject; after: WorkspaceObject }> => {
  const createdByHash = new Map<string, WorkspaceObject[]>()
  for (const item of created) {
    const matches = createdByHash.get(item.hash) || []
    matches.push(item)
    createdByHash.set(item.hash, matches)
  }
  const pairs: Array<{ before: WorkspaceObject; after: WorkspaceObject }> = []
  for (const before of deleted) {
    const candidates = createdByHash.get(before.hash)
    const after = candidates?.shift()
    if (after) pairs.push({ before, after })
  }
  return pairs
}

export class WorkspaceChangeTracker {
  private readonly runs = new Map<string, TrackedRun>()

  public async beginRun(input: {
    runId: string
    sessionId: string
    workspaceRootPath: string
    runSummary: string
  }): Promise<void> {
    const workspaceRootPath = path.resolve(input.workspaceRootPath)
    const baseline = await scanWorkspace(workspaceRootPath)
    this.runs.set(input.runId, {
      runId: input.runId,
      sessionId: input.sessionId,
      workspaceRootPath,
      runSummary: input.runSummary.trim().slice(0, 160),
      baseline
    })
  }

  public discardRun(runId: string): void {
    this.runs.delete(runId)
  }

  public async finishRun(input: {
    runId: string
    existingRecords: AiFileChangeRecord[]
  }): Promise<CompletedWorkspaceChange[]> {
    const tracked = this.runs.get(input.runId)
    if (!tracked) return []
    this.runs.delete(input.runId)

    const current = await scanWorkspace(tracked.workspaceRootPath)
    const existingByPath = new Map<string, AiFileChangeRecord>()
    for (const record of [...input.existingRecords].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const keys = [record.path, record.beforePath, record.afterPath].filter(
        (value): value is string => Boolean(value)
      )
      for (const value of keys) {
        const key = normalizePathKey(value)
        if (!existingByPath.has(key)) existingByPath.set(key, record)
      }
    }

    const updated: Array<{ before: WorkspaceObject; after: WorkspaceObject }> = []
    const deleted: WorkspaceObject[] = []
    const created: WorkspaceObject[] = []
    for (const [relativePath, before] of tracked.baseline) {
      const after = current.get(relativePath)
      if (!after) deleted.push(before)
      else if (before.hash !== after.hash) updated.push({ before, after })
    }
    for (const [relativePath, after] of current) {
      if (!tracked.baseline.has(relativePath)) created.push(after)
    }

    const renames = pairRenames(deleted, created)
    const renamedBefore = new Set(renames.map((item) => item.before.relativePath))
    const renamedAfter = new Set(renames.map((item) => item.after.relativePath))
    const changes: Array<{
      operation: AiFileChangeOperation
      before?: WorkspaceObject
      after?: WorkspaceObject
    }> = [
      ...updated.map((item) => ({ operation: 'updated' as const, ...item })),
      ...renames.map((item) => ({ operation: 'renamed' as const, ...item })),
      ...deleted
        .filter((item) => !renamedBefore.has(item.relativePath))
        .map((before) => ({ operation: 'deleted' as const, before })),
      ...created
        .filter((item) => !renamedAfter.has(item.relativePath))
        .map((after) => ({ operation: 'created' as const, after }))
    ]

    const completed: CompletedWorkspaceChange[] = []
    const matchedExistingIds = new Set<string>()
    const objectStore = new WorkspaceObjectStore(tracked.workspaceRootPath)
    for (const change of changes) {
      const targetPath = change.after?.absolutePath || change.before?.absolutePath
      if (!targetPath) continue
      const specialist =
        existingByPath.get(normalizePathKey(targetPath)) ||
        (change.before
          ? existingByPath.get(normalizePathKey(change.before.absolutePath))
          : undefined)
      if (specialist) matchedExistingIds.add(specialist.id)
      const now = Date.now()
      let previewPath = specialist?.previewPath
      let previewArtifactHash: string | undefined
      if (previewPath) {
        const previewObject = await objectStore.putFile(previewPath).catch(() => undefined)
        if (previewObject) {
          previewPath = previewObject.objectPath
          previewArtifactHash = previewObject.hash
        }
      }
      const capability = inferCapability(change.before, change.after, specialist)
      const record: AiFileChangeRecord = {
        id: specialist?.id || randomUUID(),
        sessionId: tracked.sessionId,
        runId: tracked.runId,
        status: 'applied',
        capability,
        path: targetPath,
        fileName: path.basename(targetPath),
        operation: change.operation,
        source:
          capability === 'docx'
            ? 'docx_tool'
            : specialist?.capability === 'excel'
              ? 'excel_tool'
              : specialist?.capability === 'image'
                ? 'image_tool'
                : specialist?.capability === 'text_file'
                  ? 'text_tool'
                  : 'workspace_scan',
        beforePath: change.before?.absolutePath,
        afterPath: change.after?.absolutePath,
        changeCount: specialist?.changeCount || 1,
        insertCount: specialist?.insertCount || 0,
        deleteCount: specialist?.deleteCount || 0,
        beforeSnapshotPath: change.before?.objectPath,
        afterSnapshotPath: change.after?.objectPath,
        beforeObjectHash: change.before?.hash,
        afterObjectHash: change.after?.hash,
        beforeChecksum: change.before?.hash,
        afterChecksum: change.after?.hash,
        previewPath,
        previewArtifactHash,
        runSummary: tracked.runSummary,
        createdAt: specialist?.createdAt || now,
        updatedAt: now
      }
      completed.push({ record, discoveredByScan: !specialist })
    }

    for (const record of input.existingRecords) {
      if (matchedExistingIds.has(record.id) || record.status !== 'applied') continue
      completed.push({
        record: {
          ...record,
          status: 'failed',
          error: 'Run completed without an effective workspace change.',
          updatedAt: Date.now()
        },
        discoveredByScan: false
      })
    }
    return completed
  }
}
