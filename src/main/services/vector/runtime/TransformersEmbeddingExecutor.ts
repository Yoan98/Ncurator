import type { EmbeddingExecutor, EmbeddingResult, EmbeddingThreadBudget } from './types'
import { resolveOrtThreadBudget, toOrtSessionOptions } from '../indexSpeed'

type FeatureExtractorResult = {
  data: unknown
  dims: unknown
}

type FeatureExtractor = ((
  texts: string[],
  options: { pooling: 'mean'; normalize: true }
) => Promise<FeatureExtractorResult>) & {
  dispose?: () => Promise<void>
}

const toEmbeddingDims = (value: unknown): [number, number] => {
  if (!Array.isArray(value)) return [0, 0]
  return [Number(value[0] ?? 0), Number(value[1] ?? 0)]
}

const toEmbeddingVector = (value: unknown): Float32Array => {
  if (value instanceof Float32Array) return value
  if (Array.isArray(value)) return Float32Array.from(value.map((item) => Number(item || 0)))
  if (ArrayBuffer.isView(value)) {
    return Float32Array.from(value as unknown as ArrayLike<number>)
  }
  return new Float32Array()
}

export class TransformersEmbeddingExecutor implements EmbeddingExecutor {
  private readonly modelsPath: string
  private readonly modelName: string
  private threadBudget: EmbeddingThreadBudget
  private appliedSessionOptions: ReturnType<typeof toOrtSessionOptions> | null = null
  private extractor: FeatureExtractor | null = null
  private initializationPromise: Promise<void> | null = null

  public constructor(input: {
    modelsPath: string
    modelName: string
    threadBudget?: EmbeddingThreadBudget
  }) {
    const modelsPath = String(input.modelsPath || '').trim()
    const modelName = String(input.modelName || '').trim()
    if (!modelsPath) throw new Error('embedding runtime modelsPath is required')
    if (!modelName) throw new Error('embedding runtime modelName is required')
    this.modelsPath = modelsPath
    this.modelName = modelName
    this.threadBudget = input.threadBudget || resolveOrtThreadBudget('slow')
  }

  public setThreadBudget(budget: EmbeddingThreadBudget): void {
    this.threadBudget = budget
  }

  public getThreadBudget(): EmbeddingThreadBudget {
    return this.threadBudget
  }

  public getAppliedSessionOptions(): ReturnType<typeof toOrtSessionOptions> | null {
    return this.appliedSessionOptions
  }

  public async restart(): Promise<void> {
    const extractor = this.extractor
    this.extractor = null
    this.appliedSessionOptions = null
    this.initializationPromise = null
    await extractor?.dispose?.()
  }

  public async close(): Promise<void> {
    await this.restart()
  }

  public async initialize(): Promise<void> {
    if (this.extractor) return
    if (this.initializationPromise) {
      await this.initializationPromise
      return
    }

    this.initializationPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.localModelPath = this.modelsPath
      env.allowRemoteModels = false
      env.allowLocalModels = true
      const createExtractor = pipeline as (
        task: string,
        model: string,
        options: { dtype: 'fp32'; session_options: ReturnType<typeof toOrtSessionOptions> }
      ) => Promise<FeatureExtractor>
      const sessionOptions = toOrtSessionOptions(this.threadBudget)
      this.appliedSessionOptions = sessionOptions
      this.extractor = await createExtractor('feature-extraction', this.modelName, {
        dtype: 'fp32',
        session_options: sessionOptions
      })
    })().finally(() => {
      this.initializationPromise = null
    })

    await this.initializationPromise
  }

  public async embed(texts: string[]): Promise<EmbeddingResult> {
    if (!this.extractor) {
      throw new Error('embedding runtime is not initialized')
    }
    const output = await this.extractor(texts, {
      pooling: 'mean',
      normalize: true
    })
    return {
      data: toEmbeddingVector(output.data),
      dims: toEmbeddingDims(output.dims)
    }
  }
}
