import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type { SeedKbDocumentInput } from './test-types'

const KB_FIXTURE_CACHE_SCHEMA_VERSION = 1
const KB_FIXTURE_CACHE_ROOT = path.resolve(process.cwd(), 'tests', '.cache', 'kb-fixtures')

type CacheableKbChunk = {
  id: string
  text: string
  page: number
}

type CacheableKbDocument = {
  id: string
  name: string
  sourceType: 'file' | 'web'
  chunks: CacheableKbChunk[]
}

type CachedKbChunkVector = CacheableKbChunk & {
  vector: number[]
}

type CachedKbDocumentVectors = {
  id: string
  chunks: CachedKbChunkVector[]
}

type KbFixtureCacheFile = {
  schemaVersion: 1
  modelName: string
  documents: CachedKbDocumentVectors[]
}

type KbFixtureVectorSnapshot = {
  documents: CachedKbDocumentVectors[]
}

const normalizeSourceType = (value?: 'file' | 'web'): 'file' | 'web' => value || 'file'

const toCacheableDocuments = (documents: readonly SeedKbDocumentInput[]): CacheableKbDocument[] =>
  [...documents]
    .map((document) => ({
      id: document.id,
      name: document.name,
      sourceType: normalizeSourceType(document.sourceType),
      chunks: [...document.chunks]
        .map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
          page: chunk.page || 1
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

const buildCacheKey = (
  modelName: string,
  documents: readonly CacheableKbDocument[]
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: KB_FIXTURE_CACHE_SCHEMA_VERSION,
        modelName,
        documents
      })
    )
    .digest('hex')

const buildCacheFilePath = (cacheKey: string): string =>
  path.join(KB_FIXTURE_CACHE_ROOT, `${cacheKey}.json`)

const loadCachedSnapshot = async (
  cacheFilePath: string,
  modelName: string
): Promise<KbFixtureVectorSnapshot | null> => {
  try {
    await access(cacheFilePath)
  } catch {
    return null
  }

  const file = JSON.parse(await readFile(cacheFilePath, 'utf8')) as KbFixtureCacheFile
  if (
    file.schemaVersion !== KB_FIXTURE_CACHE_SCHEMA_VERSION ||
    file.modelName !== modelName
  ) {
    return null
  }

  return {
    documents: file.documents
  }
}

const persistCachedSnapshot = async (
  cacheFilePath: string,
  modelName: string,
  snapshot: KbFixtureVectorSnapshot
): Promise<void> => {
  const payload: KbFixtureCacheFile = {
    schemaVersion: KB_FIXTURE_CACHE_SCHEMA_VERSION,
    modelName,
    documents: snapshot.documents
  }

  await mkdir(path.dirname(cacheFilePath), { recursive: true })
  await writeFile(cacheFilePath, JSON.stringify(payload), 'utf8')
}

const buildVectorSnapshot = async (
  documents: readonly CacheableKbDocument[],
  embeddingService: EmbeddingService
): Promise<KbFixtureVectorSnapshot> => {
  if (documents.length === 0) {
    return {
      documents: []
    }
  }

  const flattenedChunks = documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      documentId: document.id,
      chunk
    }))
  )
  if (flattenedChunks.length === 0) {
    return {
      documents: documents.map((document) => ({
        id: document.id,
        chunks: []
      }))
    }
  }
  const embeddingTexts = flattenedChunks.map((item) => item.chunk.text)
  const embeddings = await embeddingService.embed(embeddingTexts)
  const vectorSize = embeddings.dims[1]

  const vectors = flattenedChunks.map((_, index) =>
    Array.from(
      embeddings.data.slice(index * vectorSize, (index + 1) * vectorSize)
    )
  )

  return {
    documents: documents.map((document) => ({
      id: document.id,
      chunks: document.chunks.map((chunk) => {
        const flattenedIndex = flattenedChunks.findIndex(
          (item) => item.documentId === document.id && item.chunk.id === chunk.id
        )
        return {
          ...chunk,
          vector: vectors[flattenedIndex] || []
        }
      })
    }))
  }
}

export const loadOrBuildKbFixtureVectors = async (input: {
  embeddingService: EmbeddingService
  documents: readonly SeedKbDocumentInput[]
}): Promise<KbFixtureVectorSnapshot> => {
  const cacheableDocuments = toCacheableDocuments(input.documents)
  const modelName = input.embeddingService.getModelName()
  const cacheKey = buildCacheKey(modelName, cacheableDocuments)
  const cacheFilePath = buildCacheFilePath(cacheKey)
  const cachedSnapshot = await loadCachedSnapshot(cacheFilePath, modelName)
  if (cachedSnapshot) {
    return cachedSnapshot
  }

  const builtSnapshot = await buildVectorSnapshot(cacheableDocuments, input.embeddingService)
  await persistCachedSnapshot(cacheFilePath, modelName, builtSnapshot)
  return builtSnapshot
}
