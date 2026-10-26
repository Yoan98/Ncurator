import { ModelService } from '../model/ModelService'
import { EmbeddingService } from './EmbeddingService'

export const EMBEDDING_MODEL_NOT_INSTALLED_ERROR =
  'The embedding model is not installed or its download is incomplete. Complete the model download in Settings before using the knowledge base.'

export const ensureEmbeddingReady = async (input: {
  embeddingService: EmbeddingService
  modelService?: ModelService
}): Promise<void> => {
  const modelService = input.modelService || ModelService.getInstance()
  const repoId = input.embeddingService.getModelName()

  if (!modelService.isModelDownloaded(repoId)) {
    throw new Error(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
  }

  await input.embeddingService.initialize()

  if (input.embeddingService.getStatus() === 'ready') {
    return
  }

  throw new Error(
    `The embedding model is not ready: ${repoId} (${input.embeddingService.getStatus()})`
  )
}
