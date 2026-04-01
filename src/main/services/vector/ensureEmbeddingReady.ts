import type { ModelDownloadProgressReporter } from '../model/ModelService'
import { ModelService } from '../model/ModelService'
import { EmbeddingService } from './EmbeddingService'

export const ensureEmbeddingReady = async (input: {
  embeddingService: EmbeddingService
  modelService?: ModelService
  reporter?: ModelDownloadProgressReporter
}): Promise<void> => {
  if (input.embeddingService.getStatus() === 'ready') {
    return
  }

  const modelService = input.modelService || ModelService.getInstance()
  const repoId = input.embeddingService.getModelName()

  if (!modelService.isModelDownloaded(repoId)) {
    await modelService.downloadModel(repoId, input.reporter)
  }

  await input.embeddingService.initialize()

  if (input.embeddingService.getStatus() === 'ready') {
    return
  }

  throw new Error(
    `embedding bootstrap failed after ensuring model download; model=${repoId}; status=${input.embeddingService.getStatus()}`
  )
}
