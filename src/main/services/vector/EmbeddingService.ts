import type { EmbeddingExecutor, EmbeddingResult } from './runtime/types'

export type { EmbeddingExecutor, EmbeddingResult } from './runtime/types'

type ServiceStatus = 'uninitialized' | 'initializing' | 'ready' | 'error'

export const DEFAULT_EMBEDDING_MODEL_NAME = 'jinaai/jina-embeddings-v2-base-zh'

export class EmbeddingService {
  private readonly executor: EmbeddingExecutor
  private readonly modelName: string
  private status: ServiceStatus = 'uninitialized'
  private initializationPromise: Promise<void> | null = null

  public constructor(input: { executor: EmbeddingExecutor; modelName?: string }) {
    this.executor = input.executor
    this.modelName = input.modelName || DEFAULT_EMBEDDING_MODEL_NAME
  }

  public getModelName(): string {
    return this.modelName
  }

  public getStatus(): ServiceStatus {
    return this.status
  }

  public async initialize(): Promise<void> {
    if (this.status === 'ready') return
    if (this.initializationPromise) {
      await this.initializationPromise
      return
    }

    this.status = 'initializing'
    this.initializationPromise = this.executor
      .initialize()
      .then(() => {
        this.status = 'ready'
      })
      .catch((error: unknown) => {
        this.status = 'error'
        const message = error instanceof Error ? error.message : String(error)
        console.warn('EmbeddingService initialization failed:', message)
      })
      .finally(() => {
        this.initializationPromise = null
      })

    await this.initializationPromise
  }

  public async embed(texts: string | string[]): Promise<EmbeddingResult> {
    if (this.status !== 'ready') {
      throw new Error(
        `EmbeddingService is not ready. Current status: ${this.status}. Please wait for initialization.`
      )
    }
    const inputTexts = Array.isArray(texts) ? texts : [texts]
    return await this.executor.embed(inputTexts)
  }

  public async close(): Promise<void> {
    await this.executor.close?.()
    this.status = 'uninitialized'
  }
}
