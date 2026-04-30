import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  SPLITTER_BIG_CHUNK_SETTING,
  SPLITTER_MINI_CHUNK_SIZE
} from '../../../src/main/utils/constant'
import { IngestionService } from '../../../src/main/services/ingestion/loader'
import { WorkspaceKnowledgePrepareService } from '../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import { WorkspaceSourceService } from '../../../src/main/services/workspace/WorkspaceSourceService'
import type {
  WorkspaceKnowledgeCache,
  WorkspaceKnowledgeSplitSnapshot,
  WorkspaceKnowledgeVectorSnapshot
} from '../../../src/main/services/workspace/types'
import type {
  BackendTestRuntime,
  SeedKbDocumentInput,
  WorkspaceKbSeedInput,
  WorkspaceKbSeedResult
} from './test-types'

const WORKSPACE_KB_CACHE_SCHEMA_VERSION = 1
const WORKSPACE_KB_CACHE_ROOT = path.resolve(process.cwd(), 'tests', '.cache', 'kb-fixtures', 'workspace')
const TEST_WORKSPACE_ID = 'test-workspace'

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

type WorkspaceKbSeedExecutionResult = {
  results: WorkspaceKbSeedResult[]
  kbDocuments: SeedKbDocumentInput[]
}

const normalizeRelativePath = (value: string): string =>
  path.posix.normalize(String(value || '').trim().split(path.sep).join('/')).replace(/^\/+/, '')

const toDocumentId = (relativePath: string): string =>
  `workspace-file-${createHash('sha1').update(normalizeRelativePath(relativePath)).digest('hex')}`

const buildSplitCacheKey = (input: { contentHash: string; fileExt: string }): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: WORKSPACE_KB_CACHE_SCHEMA_VERSION,
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
        schemaVersion: WORKSPACE_KB_CACHE_SCHEMA_VERSION,
        splitCacheKey: input.splitCacheKey,
        modelName: input.modelName
      })
    )
    .digest('hex')

class WorkspaceKbFixtureCache implements WorkspaceKnowledgeCache {
  public async loadSplitSnapshot(input: {
    contentHash: string
    fileExt: string
  }): Promise<WorkspaceKnowledgeSplitSnapshot | null> {
    const cacheFilePath = path.join(
      WORKSPACE_KB_CACHE_ROOT,
      'splits',
      `${buildSplitCacheKey(input)}.json`
    )
    try {
      await access(cacheFilePath)
    } catch {
      return null
    }

    const file = JSON.parse(await readFile(cacheFilePath, 'utf8')) as PersistedWorkspaceSplitCache
    if (file.schemaVersion !== WORKSPACE_KB_CACHE_SCHEMA_VERSION) {
      return null
    }
    return file.snapshot
  }

  public async saveSplitSnapshot(snapshot: WorkspaceKnowledgeSplitSnapshot): Promise<void> {
    const cacheFilePath = path.join(
      WORKSPACE_KB_CACHE_ROOT,
      'splits',
      `${buildSplitCacheKey({
        contentHash: snapshot.contentHash,
        fileExt: snapshot.fileExt
      })}.json`
    )
    const payload: PersistedWorkspaceSplitCache = {
      schemaVersion: WORKSPACE_KB_CACHE_SCHEMA_VERSION,
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
      WORKSPACE_KB_CACHE_ROOT,
      'vectors',
      `${buildVectorCacheKey({
        splitCacheKey,
        modelName: input.modelName
      })}.json`
    )
    try {
      await access(cacheFilePath)
    } catch {
      return null
    }

    const file = JSON.parse(await readFile(cacheFilePath, 'utf8')) as PersistedWorkspaceVectorCache
    if (
      file.schemaVersion !== WORKSPACE_KB_CACHE_SCHEMA_VERSION ||
      file.splitCacheKey !== splitCacheKey
    ) {
      return null
    }
    return file.snapshot
  }

  public async saveVectorSnapshot(snapshot: WorkspaceKnowledgeVectorSnapshot): Promise<void> {
    const splitCacheKey = buildSplitCacheKey({
      contentHash: snapshot.contentHash,
      fileExt: snapshot.fileExt
    })
    const cacheFilePath = path.join(
      WORKSPACE_KB_CACHE_ROOT,
      'vectors',
      `${buildVectorCacheKey({
        splitCacheKey,
        modelName: snapshot.modelName
      })}.json`
    )
    const payload: PersistedWorkspaceVectorCache = {
      schemaVersion: WORKSPACE_KB_CACHE_SCHEMA_VERSION,
      splitCacheKey,
      snapshot
    }
    await mkdir(path.dirname(cacheFilePath), { recursive: true })
    await writeFile(cacheFilePath, JSON.stringify(payload), 'utf8')
  }
}

const createSkippedResult = (input: {
  relativePath: string
  absolutePath: string
  name: string
  fileExt?: string
  error?: string
}): WorkspaceKbSeedResult => ({
  relativePath: input.relativePath,
  absolutePath: input.absolutePath,
  name: input.name,
  fileExt: input.fileExt,
  supported: false,
  status: input.error ? 'failed' : 'skipped',
  kbAvailability: 'not_indexed',
  kbDocumentIds: [],
  cache: {
    split: false,
    vector: false
  },
  error: input.error
})

export const seedWorkspaceKb = async (input: {
  runtime: BackendTestRuntime
  params: WorkspaceKbSeedInput
}): Promise<WorkspaceKbSeedExecutionResult> => {
  const workspaceService = new WorkspaceSourceService()
  const cache = new WorkspaceKbFixtureCache()
  const prepareService = new WorkspaceKnowledgePrepareService({
    ingestionService: IngestionService.getInstance(),
    embeddingService: input.runtime.embeddingService,
    documentsStore: input.runtime.documentsStore
  })

  const scan = await workspaceService.scanWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    rootPath: input.runtime.workspaceRoot,
    workspaceName: TEST_WORKSPACE_ID
  })
  const supportedNodes = scan.nodes.filter((node) => node.kind === 'file')
  const supportedNodeMap = new Map(
    supportedNodes.map((node) => [normalizeRelativePath(node.relative_path), node] as const)
  )
  const requestedPaths = [...(input.params.relativePaths || [])].map(normalizeRelativePath)
  const requestedPathSet = new Set(requestedPaths)

  const results: WorkspaceKbSeedResult[] = []
  const kbDocuments: SeedKbDocumentInput[] = []

  if (input.params.mode === 'include-only') {
    for (const requestedPath of requestedPaths) {
      const node = supportedNodeMap.get(requestedPath)
      if (node) continue
      const absolutePath = path.join(input.runtime.workspaceRoot, requestedPath)
      let exists = false
      try {
        await access(absolutePath)
        exists = true
      } catch {
        exists = false
      }
      results.push(
        createSkippedResult({
          relativePath: requestedPath,
          absolutePath,
          name: path.basename(requestedPath) || requestedPath,
          fileExt: path.extname(requestedPath).toLowerCase() || undefined,
          error: exists ? undefined : 'workspace file not found'
        })
      )
    }
  }

  const targetNodes = supportedNodes.filter((node) => {
    const normalizedPath = normalizeRelativePath(node.relative_path)
    if (input.params.mode === 'all-supported') return true
    if (input.params.mode === 'include-only') {
      return requestedPathSet.has(normalizedPath)
    }
    return !requestedPathSet.has(normalizedPath)
  })

  for (const node of targetNodes) {
    const relativePath = normalizeRelativePath(node.relative_path)
    const absolutePath = node.absolute_path
    try {
      const indexed = await prepareService.indexLocalFile({
        workspaceId: TEST_WORKSPACE_ID,
        documentId: toDocumentId(relativePath),
        filePath: absolutePath,
        documentName: node.name,
        cache
      })
      results.push({
        relativePath,
        absolutePath,
        name: node.name,
        fileExt: path.extname(absolutePath).toLowerCase() || undefined,
        supported: true,
        status: 'indexed',
        documentId: indexed.documentId,
        chunkCount: indexed.chunkCount,
        kbAvailability: 'indexed',
        kbDocumentIds: [indexed.documentId],
        cache: {
          split: indexed.usedCachedSplit,
          vector: indexed.usedCachedVectors
        }
      })
      kbDocuments.push({
        id: indexed.documentId,
        name: indexed.documentName,
        workspaceId: TEST_WORKSPACE_ID,
        sourceType: 'file',
        filePath: indexed.filePath,
        chunks: indexed.chunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          page: chunk.page
        }))
      })
    } catch (error: unknown) {
      results.push({
        relativePath,
        absolutePath,
        name: node.name,
        fileExt: path.extname(absolutePath).toLowerCase() || undefined,
        supported: true,
        status: 'failed',
        kbAvailability: 'not_indexed',
        kbDocumentIds: [],
        cache: {
          split: false,
          vector: false
        },
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    results: results.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    kbDocuments
  }
}
