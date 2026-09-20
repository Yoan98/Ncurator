import { countProcessThreads } from '../core/processThreads.mjs'

const RESULT_PREFIX = 'NCURATOR_THREAD_PROBE:'

const input = JSON.parse(process.argv[2] || '{}')
const modelsPath = String(input.modelsPath || '').trim()
const sessionOptions = input.sessionOptions
if (!modelsPath) throw new Error('modelsPath is required')
if (!sessionOptions || !Number.isInteger(sessionOptions.intraOpNumThreads)) {
  throw new Error('sessionOptions.intraOpNumThreads is required')
}

const { pipeline, env } = await import('@huggingface/transformers')
env.localModelPath = modelsPath
env.allowRemoteModels = false
env.allowLocalModels = true

const before = countProcessThreads()
const extractor = await pipeline('feature-extraction', 'jinaai/jina-embeddings-v2-base-zh', {
  dtype: 'fp32',
  session_options: sessionOptions
})
const output = await extractor(['slow and fast index speed must change ORT threads'], {
  pooling: 'mean',
  normalize: true
})
const after = countProcessThreads()
await extractor.dispose?.()

process.stdout.write(
  `${RESULT_PREFIX}${JSON.stringify({
    before,
    after,
    delta: after - before,
    dims: output.dims
  })}\n`
)
