import { createHash, randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

type FileFingerprint = {
  meta: string
  hash: string
}

type FileWatchRecord = {
  id: string
  ownerId: number
  filePath: string
  fingerprint: FileFingerprint
  watcher: FSWatcher
  debounceTimer: NodeJS.Timeout | null
  onChange: (event: FileWatchChangeEvent) => void
}

export type FileWatchChangeEvent = {
  watchId: string
  filePath: string
}

export type FileWatchServiceOptions = {
  debounceMs?: number
}

const MISSING_FINGERPRINT = 'missing'

const isMissingFileError = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT'

const getFileMeta = async (filePath: string): Promise<string> => {
  try {
    const stat = await fs.stat(filePath)
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':')
  } catch (error) {
    if (isMissingFileError(error)) return MISSING_FINGERPRINT
    throw error
  }
}

const getFileContentHash = async (filePath: string): Promise<string> => {
  try {
    const buffer = await fs.readFile(filePath)
    return createHash('sha256').update(buffer).digest('hex')
  } catch (error) {
    if (isMissingFileError(error)) return MISSING_FINGERPRINT
    throw error
  }
}

const readFingerprint = async (filePath: string): Promise<FileFingerprint> => {
  const meta = await getFileMeta(filePath)
  if (meta === MISSING_FINGERPRINT) {
    return { meta, hash: MISSING_FINGERPRINT }
  }
  return { meta, hash: await getFileContentHash(filePath) }
}

export class FileWatchService {
  private readonly records = new Map<string, FileWatchRecord>()
  private readonly debounceMs: number

  constructor(options: FileWatchServiceOptions = {}) {
    this.debounceMs = options.debounceMs ?? 500
  }

  async start(input: {
    ownerId: number
    filePath: string
    onChange: (event: FileWatchChangeEvent) => void
  }): Promise<{ watchId: string; filePath: string }> {
    const rawPath = String(input.filePath || '').trim()
    if (!rawPath) throw new Error('filePath is required')

    const filePath = path.resolve(rawPath)
    const directoryPath = path.dirname(filePath)
    const directoryStat = await fs.stat(directoryPath)
    if (!directoryStat.isDirectory()) throw new Error('parent directory not found')

    const watchId = randomUUID()
    const fingerprint = await readFingerprint(filePath)
    const watcher = watch(directoryPath, { persistent: false }, () => {
      // Office applications can save through temporary sibling files before replacing the target.
      // Rechecking the one active target is more reliable than trusting the event filename.
      this.scheduleCheck(watchId)
    })

    const record: FileWatchRecord = {
      id: watchId,
      ownerId: input.ownerId,
      filePath,
      fingerprint,
      watcher,
      debounceTimer: null,
      onChange: input.onChange
    }
    watcher.on('error', () => this.stop(watchId))
    this.records.set(watchId, record)
    return { watchId, filePath }
  }

  async check(watchId: string): Promise<boolean> {
    const record = this.records.get(String(watchId || '').trim())
    if (!record) throw new Error('file watch not found')
    return await this.refreshFingerprint(record)
  }

  isOwnedBy(watchId: string, ownerId: number): boolean {
    return this.records.get(String(watchId || '').trim())?.ownerId === ownerId
  }

  stop(watchId: string): boolean {
    const normalizedId = String(watchId || '').trim()
    const record = this.records.get(normalizedId)
    if (!record) return false
    this.records.delete(normalizedId)
    if (record.debounceTimer) clearTimeout(record.debounceTimer)
    record.watcher.close()
    return true
  }

  stopOwner(ownerId: number): void {
    for (const record of this.records.values()) {
      if (record.ownerId === ownerId) this.stop(record.id)
    }
  }

  dispose(): void {
    for (const watchId of [...this.records.keys()]) this.stop(watchId)
  }

  private scheduleCheck(watchId: string): void {
    const record = this.records.get(watchId)
    if (!record) return
    if (record.debounceTimer) clearTimeout(record.debounceTimer)
    record.debounceTimer = setTimeout(() => {
      record.debounceTimer = null
      void this.refreshFingerprint(record)
        .then((changed) => {
          if (!changed || !this.records.has(record.id)) return
          record.onChange({ watchId: record.id, filePath: record.filePath })
        })
        .catch(() => undefined)
    }, this.debounceMs)
  }

  private async refreshFingerprint(record: FileWatchRecord): Promise<boolean> {
    const nextMeta = await getFileMeta(record.filePath)
    if (nextMeta === record.fingerprint.meta) return false
    const nextHash =
      nextMeta === MISSING_FINGERPRINT ? MISSING_FINGERPRINT : await getFileContentHash(record.filePath)
    const contentChanged = nextHash !== record.fingerprint.hash
    record.fingerprint = { meta: nextMeta, hash: nextHash }
    return contentChanged
  }
}
