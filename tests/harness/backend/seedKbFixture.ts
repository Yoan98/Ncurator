import type { DocumentsStore } from '../../../src/main/services/storage/domains/DocumentsStore'
import type { EmbeddingService } from '../../../src/main/services/vector/EmbeddingService'
import type { SeedKbDocumentInput } from './test-types'

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

  for (const document of input.documents) {
    const workspaceId = String(document.workspaceId || 'test-workspace').trim()
    await input.documentsStore.addDocument({
      id: document.id,
      name: document.name,
      source_type: document.sourceType || 'file',
      workspace_id: workspaceId,
      file_path: document.filePath,
      created_at: document.createdAt || Date.now(),
      import_status: 3
    })

    const chunks = document.chunks.map((chunk) => ({
      id: chunk.id,
      text: chunk.text,
      document_id: document.id,
      workspace_id: workspaceId,
      document_name: document.name,
      source_type: document.sourceType || 'file',
      metadata: {
        page: chunk.page || 1
      }
    }))
    const embeddings = await input.embeddingService.embed(chunks.map((chunk) => chunk.text))
    const vectorList = chunks.map((_, index) =>
      embeddings.data.slice(index * embeddings.dims[1], (index + 1) * embeddings.dims[1])
    )

    await input.documentsStore.addChunks({
      vectors: vectorList,
      chunks
    })
  }
}
