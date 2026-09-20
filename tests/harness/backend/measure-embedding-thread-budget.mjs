import { execFileSync } from 'node:child_process'
import { pipeline, env } from '@huggingface/transformers'
import { countProcessThreads } from '../core/processThreads.mjs'

const sessionOptions = JSON.parse(String(process.argv[2] || 'null'))
if (!sessionOptions || !Number.isInteger(sessionOptions.intraOpNumThreads)) {
  throw new Error('session_options.intraOpNumThreads is required')
}

const modelsPath = String(process.env.NCURATOR_MODELS_PATH || '').trim()
const modelName = String(
  process.env.NCURATOR_EMBEDDING_MODEL_NAME || 'jinaai/jina-embeddings-v2-base-zh'
).trim()
if (!modelsPath) throw new Error('NCURATOR_MODELS_PATH is required')

env.localModelPath = modelsPath
env.allowRemoteModels = false
env.allowLocalModels = true

const before = countProcessThreads()
const extractor = await pipeline('feature-extraction', modelName, {
  dtype: 'fp32',
  session_options: sessionOptions
})
await extractor(['索引速度'], { pooling: 'mean', normalize: true })
const after = countProcessThreads()
process.stdout.write(
  `${JSON.stringify({
    intraOpNumThreads: sessionOptions.intraOpNumThreads,
    before,
    after
  })}\n`
)
await extractor.dispose?.()
