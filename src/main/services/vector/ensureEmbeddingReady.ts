import { ModelService } from '../model/ModelService'
import { EmbeddingService } from './EmbeddingService'

export const EMBEDDING_MODEL_NOT_INSTALLED_ERROR =
  '向量模型尚未安装或下载未完成，请在设置页完成模型下载后再使用知识库。'

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

  throw new Error(`向量模型未就绪：${repoId} (${input.embeddingService.getStatus()})`)
}
