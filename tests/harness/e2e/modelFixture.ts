import os from 'node:os'
import path from 'node:path'
import { ModelService } from '../../../src/main/services/model/ModelService'

export const E2E_MODEL_REPO_ID = 'jinaai/jina-embeddings-v2-base-zh'

const SHARED_MODELS_DIRNAME = 'ncurator-e2e-shared-models'

export const resolveSharedE2EModelsPath = (): string => {
  const tempRoot = String(process.env.NCURATOR_E2E_TEMP_ROOT || '').trim() || os.tmpdir()
  return path.join(tempRoot, SHARED_MODELS_DIRNAME)
}

export const ensureE2EModelReady = async (): Promise<string> => {
  const modelsPath = resolveSharedE2EModelsPath()
  process.env.NCURATOR_MODELS_PATH = modelsPath
  const modelService = ModelService.getInstance()
  if (!modelService.isModelDownloaded(E2E_MODEL_REPO_ID)) {
    await modelService.downloadModel(E2E_MODEL_REPO_ID)
  }
  return modelsPath
}
