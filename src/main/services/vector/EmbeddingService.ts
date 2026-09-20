import type { EmbeddingExecutor, EmbeddingResult, EmbeddingThreadBudget } from './runtime/types'
import { toEmbeddingInitializationMessage } from './embeddingError'
import { resolveOrtThreadBudget } from './indexSpeed'
import type {
  EmbeddingRuntimeSnapshot,
  EmbeddingServiceStatus,
  KnowledgeIndexSpeed
} from '../../../shared/types'

export type { EmbeddingExecutor, EmbeddingResult } from './runtime/types'

export const DEFAULT_EMBEDDING_MODEL_NAME = 'jinaai/jina-embeddings-v2-base-zh'

export class EmbeddingService {
  private readonly executor: EmbeddingExecutor
  private readonly modelName: string
  private status: EmbeddingServiceStatus = 'uninitialized'
  private initializationPromise: Promise<void> | null = null

  public constructor(input: { executor: EmbeddingExecutor; modelName?: string }) {
    this.executor = input.executor
    this.modelName = input.modelName || DEFAULT_EMBEDDING_MODEL_NAME
  }

  public getModelName(): string {
    return this.modelName
  }

  public getStatus(): EmbeddingServiceStatus {
    return this.status
  }

  public getRuntimeSnapshot(): EmbeddingRuntimeSnapshot {
    const processInfo = this.executor.getRuntimeProcessInfo?.()
    return {
      status: this.status,
      pid: processInfo?.pid ?? null,
      intraOpNumThreads: processInfo?.intraOpNumThreads ?? 0
    }
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
        throw new Error(toEmbeddingInitializationMessage(error), {
          cause: error instanceof Error ? error : undefined
        })
      })
      .finally(() => {
        this.initializationPromise = null
      })

    await this.initializationPromise
  }

  public async embed(texts: string | string[]): Promise<EmbeddingResult> {
    if (this.status !== 'ready') {
      await this.initialize()
    }
    if (this.status !== 'ready') {
      throw new Error(`EmbeddingService initialization ended in unexpected status: ${this.status}`)
    }
    const inputTexts = Array.isArray(texts) ? texts : [texts]
    return await this.executor.embed(inputTexts)
  }

  public async applyIndexSpeed(speed: KnowledgeIndexSpeed): Promise<void> {
    await this.applyThreadBudget(resolveOrtThreadBudget(speed))
  }

  public async applyThreadBudget(budget: EmbeddingThreadBudget): Promise<void> {
    this.executor.setThreadBudget?.(budget)
    await this.executor.restart?.()
    this.status = 'uninitialized'
  }

  public async close(): Promise<void> {
    await this.executor.close?.()
    this.status = 'uninitialized'
  }
}
