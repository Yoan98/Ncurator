import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SPLITTER_BIG_CHUNK_SETTING, SPLITTER_MINI_CHUNK_SIZE } from '../../utils/constant'
import { USER_DATA_PATH } from '../../utils/paths'
import type {
  WorkspaceKnowledgeCache,
  WorkspaceKnowledgeSplitSnapshot,
  WorkspaceKnowledgeVectorSnapshot
} from './types'

const WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION = 1

type WorkspaceKnowledgeCacheStats = {
  splitCacheHits: number
  splitCacheMisses: number
  vectorCacheHits: number
  vectorCacheMisses: number
}

const EMPTY_CACHE_STATS: WorkspaceKnowledgeCacheStats = {
  splitCacheHits: 0,
  splitCacheMisses: 0,
  vectorCacheHits: 0,
  vectorCacheMisses: 0
}

type PersistedWorkspaceSplitCache = {
  schemaVersion: number
  splitter: {
    big: typeof SPLITTER_BIG_CHUNK_SETTING
    mini: typeof SPLITTER_MINI_CHUNK_SIZE
  }
  snapshot: WorkspaceKnowledgeSplitSnapshot
}

type PersistedWorkspaceVectorCache = {
  schemaVersion: number
  splitCacheKey: string
  snapshot: WorkspaceKnowledgeVectorSnapshot
}

const isWorkspaceKnowledgeCacheEnabled = (): boolean =>
  String(process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE || '').trim() === '1'

const resolveWorkspaceKnowledgeCacheRoot = (): string => {
  const explicitPath = String(process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH || '').trim()
  if (explicitPath) return path.resolve(explicitPath)
  return path.join(USER_DATA_PATH, 'workspace-knowledge-cache')
}

const buildSplitCacheKey = (input: { contentHash: string; fileExt: string }): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION,
        contentHash: input.contentHash,
        fileExt: input.fileExt,
        splitter: {
          big: SPLITTER_BIG_CHUNK_SETTING,
          mini: SPLITTER_MINI_CHUNK_SIZE
        }
      })
    )
    .digest('hex')

const buildVectorCacheKey = (input: { splitCacheKey: string; modelName: string }): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION,
        splitCacheKey: input.splitCacheKey,
        modelName: input.modelName
      })
    )
    .digest('hex')

class PersistentWorkspaceKnowledgeCache implements WorkspaceKnowledgeCache {
  private readonly statsPath: string
  private stats: WorkspaceKnowledgeCacheStats = { ...EMPTY_CACHE_STATS }
  private statsInitialization: Promise<void> | null = null
  private statsWriteQueue: Promise<void> = Promise.resolve()
  private statsWriteSequence = 0

  public constructor(private readonly cacheRoot: string) {
    this.statsPath = path.join(cacheRoot, 'stats.json')
  }

  private async initializeStats(): Promise<void> {
    if (!this.statsInitialization) {
      this.statsInitialization = (async () => {
        try {
          const parsed = JSON.parse(
            await readFile(this.statsPath, 'utf8')
          ) as Partial<WorkspaceKnowledgeCacheStats>
          this.stats = {
            splitCacheHits: Number(parsed.splitCacheHits || 0),
            splitCacheMisses: Number(parsed.splitCacheMisses || 0),
            vectorCacheHits: Number(parsed.vectorCacheHits || 0),
            vectorCacheMisses: Number(parsed.vectorCacheMisses || 0)
          }
        } catch {
          this.stats = { ...EMPTY_CACHE_STATS }
        }
      })()
    }
    await this.statsInitialization
  }

  private async recordStat(key: keyof WorkspaceKnowledgeCacheStats): Promise<void> {
    await this.initializeStats()
    this.stats[key] += 1
    this.statsWriteSequence += 1
    const tempPath = `${this.statsPath}.${String(process.pid)}.${String(this.statsWriteSequence)}.tmp`
    this.statsWriteQueue = this.statsWriteQueue.then(async () => {
      await mkdir(this.cacheRoot, { recursive: true })
      await writeFile(tempPath, `${JSON.stringify(this.stats, null, 2)}\n`, 'utf8')
      await rename(tempPath, this.statsPath)
    })
    await this.statsWriteQueue
  }

  public async loadSplitSnapshot(input: {
    contentHash: string
    fileExt: string
  }): Promise<WorkspaceKnowledgeSplitSnapshot | null> {
    const cacheFilePath = path.join(this.cacheRoot, 'splits', `${buildSplitCacheKey(input)}.json`)
    try {
      const file = JSON.parse(await readFile(cacheFilePath, 'utf8')) as PersistedWorkspaceSplitCache
      if (file.schemaVersion !== WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION) {
        await this.recordStat('splitCacheMisses')
        return null
      }
      await this.recordStat('splitCacheHits')
      return file.snapshot
    } catch {
      await this.recordStat('splitCacheMisses')
      return null
    }
  }

  public async saveSplitSnapshot(snapshot: WorkspaceKnowledgeSplitSnapshot): Promise<void> {
    const cacheFilePath = path.join(
      this.cacheRoot,
      'splits',
      `${buildSplitCacheKey({
        contentHash: snapshot.contentHash,
        fileExt: snapshot.fileExt
      })}.json`
    )
    const payload: PersistedWorkspaceSplitCache = {
      schemaVersion: WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION,
      splitter: {
        big: SPLITTER_BIG_CHUNK_SETTING,
        mini: SPLITTER_MINI_CHUNK_SIZE
      },
      snapshot
    }
    await mkdir(path.dirname(cacheFilePath), { recursive: true })
    await writeFile(cacheFilePath, JSON.stringify(payload), 'utf8')
  }

  public async loadVectorSnapshot(input: {
    contentHash: string
    fileExt: string
    modelName: string
  }): Promise<WorkspaceKnowledgeVectorSnapshot | null> {
    const splitCacheKey = buildSplitCacheKey({
      contentHash: input.contentHash,
      fileExt: input.fileExt
    })
    const cacheFilePath = path.join(
      this.cacheRoot,
      'vectors',
      `${buildVectorCacheKey({
        splitCacheKey,
        modelName: input.modelName
      })}.json`
    )
    try {
      const file = JSON.parse(
        await readFile(cacheFilePath, 'utf8')
      ) as PersistedWorkspaceVectorCache
      if (
        file.schemaVersion !== WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION ||
        file.splitCacheKey !== splitCacheKey
      ) {
        await this.recordStat('vectorCacheMisses')
        return null
      }
      await this.recordStat('vectorCacheHits')
      return file.snapshot
    } catch {
      await this.recordStat('vectorCacheMisses')
      return null
    }
  }

  public async saveVectorSnapshot(snapshot: WorkspaceKnowledgeVectorSnapshot): Promise<void> {
    const splitCacheKey = buildSplitCacheKey({
      contentHash: snapshot.contentHash,
      fileExt: snapshot.fileExt
    })
    const cacheFilePath = path.join(
      this.cacheRoot,
      'vectors',
      `${buildVectorCacheKey({
        splitCacheKey,
        modelName: snapshot.modelName
      })}.json`
    )
    const payload: PersistedWorkspaceVectorCache = {
      schemaVersion: WORKSPACE_KNOWLEDGE_CACHE_SCHEMA_VERSION,
      splitCacheKey,
      snapshot
    }
    await mkdir(path.dirname(cacheFilePath), { recursive: true })
    await writeFile(cacheFilePath, JSON.stringify(payload), 'utf8')
  }
}

export const createWorkspaceKnowledgeCache = (): WorkspaceKnowledgeCache | null => {
  if (!isWorkspaceKnowledgeCacheEnabled()) return null
  return new PersistentWorkspaceKnowledgeCache(resolveWorkspaceKnowledgeCacheRoot())
}
