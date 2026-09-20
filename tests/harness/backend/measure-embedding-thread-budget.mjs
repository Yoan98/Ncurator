import { execFileSync } from 'node:child_process'
import { pipeline, env } from '@huggingface/transformers'

const countProcessThreads = (pid = process.pid) => {
  if (process.platform === 'darwin') {
    const out = execFileSync('ps', ['-M', '-p', String(pid)], { encoding: 'utf8' })
    return Math.max(0, out.trim().split('\n').length - 1)
  }
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).Threads.Count`],
      { encoding: 'utf8' }
    )
    const count = Number(out.trim())
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`invalid windows thread count: ${out}`)
    }
    return count
  }
  throw new Error(`unsupported platform: ${process.platform}`)
}

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
