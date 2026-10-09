import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getModelsPath } from '../../../src/main/utils/paths'
import { ModelService } from '../../../src/main/services/model/ModelService'
import { DEFAULT_EMBEDDING_MODEL_NAME } from '../../../src/main/services/vector/EmbeddingService'

/** Isolates real model files without replacing production availability checks. */
export const withIsolatedModels = async (
  run: (modelsPath: string, sharedModelsPath: string) => Promise<void>
): Promise<void> => {
  const previous = process.env.NCURATOR_MODELS_PATH
  const sharedModelsPath = getModelsPath()
  const modelsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-model-boundary-'))
  process.env.NCURATOR_MODELS_PATH = modelsPath
  try {
    await run(modelsPath, sharedModelsPath)
  } finally {
    if (previous === undefined) delete process.env.NCURATOR_MODELS_PATH
    else process.env.NCURATOR_MODELS_PATH = previous
    await fs.rm(modelsPath, { recursive: true, force: true })
  }
}

/** Explicit test setup; KB calls never download a missing model. */
export const copyInstalledEmbeddingModel = async (
  modelsPath: string,
  sharedModelsPath: string
): Promise<void> => {
  process.env.NCURATOR_MODELS_PATH = sharedModelsPath
  try {
    const service = ModelService.getInstance()
    if (!service.isModelDownloaded(DEFAULT_EMBEDDING_MODEL_NAME)) {
      await service.downloadModel(DEFAULT_EMBEDDING_MODEL_NAME)
    }
    await fs.cp(
      path.join(sharedModelsPath, DEFAULT_EMBEDDING_MODEL_NAME),
      path.join(modelsPath, DEFAULT_EMBEDDING_MODEL_NAME),
      { recursive: true, mode: constants.COPYFILE_FICLONE }
    )
  } finally {
    process.env.NCURATOR_MODELS_PATH = modelsPath
  }
}

/** Non-empty required files pass installation checks but fail real Transformers initialization. */
export const writeCorruptEmbeddingModel = async (modelsPath: string): Promise<void> => {
  for (const name of [
    '1_Pooling/config.json',
    'config.json',
    'config_sentence_transformers.json',
    'merges.txt',
    'modules.json',
    'onnx/model.onnx',
    'sentence_bert_config.json',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json'
  ]) {
    const target = path.join(modelsPath, DEFAULT_EMBEDDING_MODEL_NAME, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, 'invalid model file')
  }
}
