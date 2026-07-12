import type { DocumentsStore } from '../../../src/main/services/storage/domains/DocumentsStore'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type { SeedKbDocumentInput } from './test-types'
import { loadOrBuildKbFixtureVectors } from './kbFixtureCache'

export const seedKbFixture = async (input: {
  documentsStore: DocumentsStore
  embeddingService: EmbeddingService
  documents: readonly SeedKbDocumentInput[]
}): Promise<void> => {
  if (input.embeddingService.getStatus() === 'uninitialized') {
    await input.embeddingService.initialize()
  }

  if (input.embeddingService.getStatus() !== 'ready') {
    throw new Error(
      `real KB fixture requires a ready EmbeddingService; current status=${input.embeddingService.getStatus()}`
    )
  }

  const vectorSnapshot = await loadOrBuildKbFixtureVectors({
    embeddingService: input.embeddingService,
    documents: input.documents
  })

  for (const document of input.documents) {
    const workspaceId = String(document.workspaceId || 'test-workspace').trim()
    const generationId = `seed-${document.id}`
    await input.documentsStore.addDocument({
      id: document.id,
      name: document.name,
      source_type: document.sourceType || 'file',
      workspace_id: workspaceId,
      file_path: document.filePath,
      created_at: document.createdAt || Date.now(),
      import_status: 2,
      active_generation_id: generationId,
      source_url: document.sourceUrl
    })

    const chunks = document.chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      document_id: document.id,
      workspace_id: workspaceId,
      document_name: document.name,
      source_type: document.sourceType || 'file',
      generation_id: generationId,
      metadata: {
        page: chunk.page || 1
      }
    }))
    const cachedDocument = vectorSnapshot.documents.find(
      (item) => item.id === document.id
    )
    if (!cachedDocument) {
      throw new Error(`cached KB vectors missing document: ${document.id}`)
    }
    const vectorList = document.chunks.map((chunk) => {
      const cachedChunk = cachedDocument.chunks.find((item) => item.id === chunk.id)
      if (!cachedChunk) {
        throw new Error(`cached KB vectors missing chunk: ${document.id}/${chunk.id}`)
      }
      return Float32Array.from(cachedChunk.vector)
    })

    await input.documentsStore.addChunks({
      vectors: vectorList,
      chunks
    })
  }
}
