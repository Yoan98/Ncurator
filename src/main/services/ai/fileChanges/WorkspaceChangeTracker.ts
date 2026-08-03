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

type WorkspaceObject = {
  relativePath: string
  absolutePath: string
  objectPath: string
  hash: string
  size: number
  mode: number
}

type TrackedTerminalCommand = {
  runId: string
  sessionId: string
  workspaceRootPath: string
  runSummary: string
  baseline: Map<string, WorkspaceObject>
}

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
  after: WorkspaceObject | undefined
): AiFileChangeCapability => {
  const extension = path.extname(after?.absolutePath || before?.absolutePath || '').toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) return 'text_file'
  if (EXCEL_EXTENSIONS.has(extension)) return 'excel'
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

export class TerminalCommandChangeTracker {
  private readonly commands = new Map<string, TrackedTerminalCommand>()

  public async beginCommand(input: {
    commandId: string
    runId: string
    sessionId: string
    workspaceRootPath: string
    command: string
  }): Promise<void> {
    const workspaceRootPath = path.resolve(input.workspaceRootPath)
    const baseline = await scanWorkspace(workspaceRootPath)
    this.commands.set(input.commandId, {
      runId: input.runId,
      sessionId: input.sessionId,
      workspaceRootPath,
      runSummary: input.command.trim().slice(0, 160),
      baseline
    })
  }

  public discardCommand(commandId: string): void {
    this.commands.delete(commandId)
  }

  public async finishCommand(commandId: string): Promise<AiFileChangeRecord[]> {
    const tracked = this.commands.get(commandId)
    if (!tracked) return []
    this.commands.delete(commandId)

    const current = await scanWorkspace(tracked.workspaceRootPath)

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

    const records: AiFileChangeRecord[] = []
    for (const change of changes) {
      const targetPath = change.after?.absolutePath || change.before?.absolutePath
      if (!targetPath) continue
      const now = Date.now()
      const capability = inferCapability(change.before, change.after)
      const record: AiFileChangeRecord = {
        id: randomUUID(),
        sessionId: tracked.sessionId,
        runId: tracked.runId,
        status: 'applied',
        capability,
        path: targetPath,
        fileName: path.basename(targetPath),
        operation: change.operation,
        source: 'terminal_tool',
        beforePath: change.before?.absolutePath,
        afterPath: change.after?.absolutePath,
        changeCount: 1,
        insertCount: 0,
        deleteCount: 0,
        beforeSnapshotPath: change.before?.objectPath,
        afterSnapshotPath: change.after?.objectPath,
        beforeObjectHash: change.before?.hash,
        afterObjectHash: change.after?.hash,
        beforeChecksum: change.before?.hash,
        afterChecksum: change.after?.hash,
        runSummary: tracked.runSummary,
        createdAt: now,
        updatedAt: now
      }
      records.push(record)
    }
    return records
  }
}
