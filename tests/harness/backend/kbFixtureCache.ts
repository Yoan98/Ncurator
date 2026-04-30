import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type { SeedKbDocumentInput } from './test-types'

const KB_FIXTURE_CACHE_SCHEMA_VERSION = 2
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
  schemaVersion: number
  modelName: string
  document: {
    id: string
    chunks: CachedKbChunkVector[]
  }
}

type KbFixtureVectorSnapshot = {
  documents: Array<{
    id: string
    chunks: CachedKbChunkVector[]
  }>
}

const normalizeSourceType = (value?: 'file' | 'web'): 'file' | 'web' => value || 'file'

const toCacheableDocument = (document: SeedKbDocumentInput): CacheableKbDocument => ({
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
})

const buildCacheKey = (modelName: string, document: CacheableKbDocument): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: KB_FIXTURE_CACHE_SCHEMA_VERSION,
        modelName,
        document
      })
    )
    .digest('hex')

const buildCacheFilePath = (cacheKey: string): string =>
  path.join(KB_FIXTURE_CACHE_ROOT, 'documents', `${cacheKey}.json`)

const loadCachedDocumentVectors = async (
  cacheFilePath: string,
  modelName: string
): Promise<CachedKbDocumentVectors['document'] | null> => {
  try {
    await access(cacheFilePath)
  } catch {
    return null
  }

  const file = JSON.parse(await readFile(cacheFilePath, 'utf8')) as CachedKbDocumentVectors
  if (file.schemaVersion !== KB_FIXTURE_CACHE_SCHEMA_VERSION || file.modelName !== modelName) {
    return null
  }
  return file.document
}

const persistCachedDocumentVectors = async (
  cacheFilePath: string,
  modelName: string,
  documentVectors: CachedKbDocumentVectors['document']
): Promise<void> => {
  const payload: CachedKbDocumentVectors = {
    schemaVersion: KB_FIXTURE_CACHE_SCHEMA_VERSION,
    modelName,
    document: documentVectors
  }
  await mkdir(path.dirname(cacheFilePath), { recursive: true })
  await writeFile(cacheFilePath, JSON.stringify(payload), 'utf8')
}

const buildDocumentVectors = async (
  document: CacheableKbDocument,
  embeddingService: EmbeddingService
): Promise<CachedKbDocumentVectors['document']> => {
  if (document.chunks.length === 0) {
    return {
      id: document.id,
      chunks: []
    }
  }

  const embeddings = await embeddingService.embed(document.chunks.map((chunk) => chunk.text))
  const vectorSize = embeddings.dims[1]
  return {
    id: document.id,
    chunks: document.chunks.map((chunk, index) => ({
      ...chunk,
      vector: Array.from(embeddings.data.slice(index * vectorSize, (index + 1) * vectorSize))
    }))
  }
}

export const loadOrBuildKbFixtureVectors = async (input: {
  embeddingService: EmbeddingService
  documents: readonly SeedKbDocumentInput[]
}): Promise<KbFixtureVectorSnapshot> => {
  const modelName = input.embeddingService.getModelName()
  const documents = await Promise.all(
    input.documents.map(async (document) => {
      const cacheableDocument = toCacheableDocument(document)
      const cacheFilePath = buildCacheFilePath(buildCacheKey(modelName, cacheableDocument))
      const cachedVectors = await loadCachedDocumentVectors(cacheFilePath, modelName)
      if (cachedVectors) {
        return cachedVectors
      }

      const builtVectors = await buildDocumentVectors(cacheableDocument, input.embeddingService)
      await persistCachedDocumentVectors(cacheFilePath, modelName, builtVectors)
      return builtVectors
    })
  )

  return { documents }
}
