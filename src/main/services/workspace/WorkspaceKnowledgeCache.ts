import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { getUserDataPath } from '../../utils/userDataPath'
import { writeJsonAtomically } from '../../utils/writeJsonAtomically'
import { getModelAssetIdentity } from '../vector/runtime/modelAssetIdentity'
import { IndexPrepareCancelledError } from './WorkspaceIndexPrepareController'
import type {
  WorkspaceKnowledgeCache,
  WorkspaceKnowledgeSplitKey,
  WorkspaceKnowledgeVectorKey,
  WorkspaceKnowledgeSplitSnapshot,
  WorkspaceKnowledgeVectorSnapshot
} from './types'

declare const __NCURATOR_KNOWLEDGE_IDENTITY__: { split: string; embedding: string } | undefined
const SCHEMA = 3
const digest = (value: object): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
type PipelineIdentity = { split: string; embedding: string }
type CacheStats = {
  splitCacheHits: number
  splitCacheMisses: number
  vectorCacheHits: number
  vectorCacheMisses: number
}
const emptyStats = (): CacheStats => ({
  splitCacheHits: 0,
  splitCacheMisses: 0,
  vectorCacheHits: 0,
  vectorCacheMisses: 0
})

// Locks are process-owned: a killed warm-up is reclaimed without expiring a slow,
// healthy embedding operation. Every caller rechecks the entry inside the lock.
const locked = async <T>(
  directory: string,
  action: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> => {
  await mkdir(path.dirname(directory), { recursive: true })
  const owner = `${process.pid}-${randomUUID()}`
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw new IndexPrepareCancelledError()
    try {
      await mkdir(directory)
      await writeFile(path.join(directory, owner), '')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owners = await readdir(directory).catch(() => [])
      for (const previous of owners) {
        const pid = Number(previous.split('-')[0])
        if (!Number.isSafeInteger(pid) || pid <= 0) continue
        try {
          process.kill(pid, 0)
        } catch (probeError) {
          if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') continue
          // Only the contender that removed this specific dead owner can reclaim
          // its directory. Others cannot remove a newly acquired lock.
          try {
            await unlink(path.join(directory, previous))
            await rmdir(directory)
          } catch {
            /* reclaimed by another contender */
          }
        }
      }
      if (owners.length === 0) {
        const info = await stat(directory).catch(() => null)
        if (info && Date.now() - info.mtimeMs > 5_000) await rmdir(directory).catch(() => {})
      }
      if (Date.now() - started > 900_000)
        throw new Error(`Timed out waiting for knowledge computation lock: ${directory}`)
      await setTimeout(100)
    }
  }
  try {
    return await action()
  } finally {
    await unlink(path.join(directory, owner))
    await rmdir(directory)
  }
}

class PersistentWorkspaceKnowledgeCache implements WorkspaceKnowledgeCache {
  private readonly statsPath: string
  public constructor(
    private readonly root: string,
    private readonly pipeline: PipelineIdentity
  ) {
    this.statsPath =
      process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_STATS_PATH || path.join(root, 'stats.json')
  }
  private async record(key: keyof CacheStats): Promise<void> {
    await locked(`${this.statsPath}.lock`, async () => {
      const previous = await readFile(this.statsPath, 'utf8')
        .then((raw) => JSON.parse(raw) as Partial<CacheStats> | null)
        .catch(() => null)
      const stats = emptyStats()
      for (const field of Object.keys(stats) as Array<keyof CacheStats>) {
        const value = Number(previous?.[field])
        stats[field] = Number.isFinite(value) && value >= 0 ? value : 0
      }
      stats[key] += 1
      await writeJsonAtomically(this.statsPath, stats)
    })
  }
  public withLock<T>(key: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return locked(
      path.join(this.root, 'locks', `${digest({ key, pipeline: this.pipeline })}.lock`),
      action,
      signal
    )
  }
  private splitKey(input: WorkspaceKnowledgeSplitKey): string {
    return digest({ schema: SCHEMA, pipeline: this.pipeline.split, ...input })
  }
  private async vectorKey(
    input: Pick<WorkspaceKnowledgeVectorKey, 'texts' | 'modelName'>
  ): Promise<string> {
    return digest({
      schema: SCHEMA,
      pipeline: this.pipeline.embedding,
      modelName: input.modelName,
      modelAssets: await getModelAssetIdentity(input.modelName),
      texts: input.texts
    })
  }
  private async load<T extends object>(kind: string, key: string): Promise<T | null> {
    try {
      const file = JSON.parse(
        await readFile(path.join(this.root, kind, `${key}.json`), 'utf8')
      ) as {
        key: string
        checksum: string
        payload: T
      }
      if (file.key === key && digest(file.payload) === file.checksum) return file.payload
      console.info(`[knowledge-cache] ${kind} miss key=${key.slice(0, 12)} reason=integrity`)
      return null
    } catch (error) {
      console.info(
        `[knowledge-cache] ${kind} miss key=${key.slice(0, 12)} reason=${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unreadable'}`
      )
      return null
    }
  }
  private async save(kind: string, key: string, payload: object): Promise<void> {
    await writeJsonAtomically(path.join(this.root, kind, `${key}.json`), {
      key,
      checksum: digest(payload),
      payload
    })
  }
  public async loadSplitSnapshot(
    input: WorkspaceKnowledgeSplitKey
  ): Promise<WorkspaceKnowledgeSplitSnapshot | null> {
    const snapshot = await this.load<WorkspaceKnowledgeSplitSnapshot>(
      'splits',
      this.splitKey(input)
    )
    const valid =
      snapshot?.contentHash === input.contentHash &&
      snapshot.fileExt === input.fileExt &&
      Array.isArray(snapshot.chunks) &&
      snapshot.chunks.every(
        (chunk) => typeof chunk.text === 'string' && Number.isFinite(chunk.page)
      )
    await this.record(valid ? 'splitCacheHits' : 'splitCacheMisses')
    return valid ? snapshot : null
  }
  public saveSplitSnapshot(
    snapshot: WorkspaceKnowledgeSplitSnapshot,
    sourceName: string
  ): Promise<void> {
    return this.save(
      'splits',
      this.splitKey({ contentHash: snapshot.contentHash, fileExt: snapshot.fileExt, sourceName }),
      snapshot
    )
  }
  public async loadVectorSnapshot(
    input: WorkspaceKnowledgeVectorKey
  ): Promise<WorkspaceKnowledgeVectorSnapshot | null> {
    const payload = await this.load<{ vectors: number[][] }>('vectors', await this.vectorKey(input))
    const vectors = payload?.vectors
    const valid =
      Array.isArray(vectors) &&
      vectors.length === input.texts.length &&
      vectors.every(
        (vector) =>
          Array.isArray(vector) &&
          vector.length > 0 &&
          vector.length === vectors[0].length &&
          vector.every(Number.isFinite)
      )
    await this.record(valid ? 'vectorCacheHits' : 'vectorCacheMisses')
    return valid
      ? {
          contentHash: input.contentHash,
          fileExt: input.fileExt,
          modelName: input.modelName,
          vectors
        }
      : null
  }
  public async saveVectorSnapshot(
    snapshot: WorkspaceKnowledgeVectorSnapshot,
    texts: string[]
  ): Promise<void> {
    await this.save('vectors', await this.vectorKey({ modelName: snapshot.modelName, texts }), {
      vectors: snapshot.vectors
    })
  }
}

export const createWorkspaceKnowledgeCache = (options?: {
  root: string
  pipeline: PipelineIdentity
}): WorkspaceKnowledgeCache | null => {
  if (!options && process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE !== '1') return null
  const pipeline =
    options?.pipeline ??
    (typeof __NCURATOR_KNOWLEDGE_IDENTITY__ !== 'undefined'
      ? __NCURATOR_KNOWLEDGE_IDENTITY__
      : (JSON.parse(process.env.NCURATOR_KNOWLEDGE_IDENTITY || 'null') as PipelineIdentity | null))
  // Older packages have no baked identity; safely recompute instead of borrowing source identity.
  if (!pipeline?.split || !pipeline.embedding) return null
  return new PersistentWorkspaceKnowledgeCache(
    options?.root ||
      process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH ||
      path.join(getUserDataPath(), 'workspace-knowledge-cache'),
    pipeline
  )
}
