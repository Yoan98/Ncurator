import type { EmbeddingExecutor, EmbeddingResult, EmbeddingThreadBudget } from './runtime/types'
import { toEmbeddingInitializationMessage } from './embeddingError'
import { resolveOrtThreadBudget } from './indexSpeed'
import { splitEmbeddingText } from './runtime/embeddingInputBudget'
import { DEFAULT_EMBEDDING_INPUT_TOKENS } from '../../../shared/embeddingModels'
import type {
  EmbeddingRuntimeSnapshot,
  EmbeddingServiceStatus,
  KnowledgeIndexSpeed
} from '../../../shared/types'

export type { EmbeddingExecutor, EmbeddingResult } from './runtime/types'

export const DEFAULT_EMBEDDING_MODEL_NAME = 'jinaai/jina-embeddings-v2-base-zh'

export class EmbeddingService {
  private executor: EmbeddingExecutor
  private modelName: string
  private identity: string
  private kind: 'local' | 'remote' = 'local'
  private maxInputTokens: number | undefined
  private configurationVersion = 0
  private status: EmbeddingServiceStatus = 'uninitialized'
  private initializationPromise: Promise<void> | null = null

  public constructor(input: { executor: EmbeddingExecutor; modelName?: string }) {
    this.executor = input.executor
    this.modelName = input.modelName || DEFAULT_EMBEDDING_MODEL_NAME
    this.identity = `local:${this.modelName}`
  }

  /**
   * 立即发布新配置，初始化仍由首次使用触发。旧执行器在其初始化结束后异步关闭，清理失败只记录日志。
   *
   * Publish the new configuration immediately and initialize it on first use. Close the previous
   * executor asynchronously after its initialization settles, logging any cleanup failure.
   */
  public async configure(input: {
    executor: EmbeddingExecutor
    modelName: string
    identity: string
    kind: 'local' | 'remote'
    maxInputTokens?: number
  }): Promise<void> {
    if (!input.modelName.trim() || !input.identity.trim()) {
      throw new Error('Embedding modelName and identity are required')
    }
    const previousExecutor = this.executor
    const previousInitialization = this.initializationPromise
    this.configurationVersion += 1
    this.executor = input.executor
    this.modelName = input.modelName
    this.identity = input.identity
    this.kind = input.kind
    this.maxInputTokens =
      input.kind === 'remote' ? (input.maxInputTokens ?? DEFAULT_EMBEDDING_INPUT_TOKENS) : undefined
    this.status = 'uninitialized'
    this.initializationPromise = null

    if (previousExecutor !== input.executor) {
      void this.closePreviousExecutor(previousExecutor, previousInitialization)
    }
  }

  private async closePreviousExecutor(
    executor: EmbeddingExecutor,
    initialization: Promise<void> | null
  ): Promise<void> {
    try {
      await executor.cancelPending?.()
      await initialization?.catch(() => undefined)
      if (this.executor === executor) return
      await executor.close?.()
    } catch (error) {
      console.error('[EMBEDDING] Failed to close the previous executor', error)
    }
  }

  private assertConfiguration(version: number): void {
    if (version !== this.configurationVersion) {
      throw new Error(
        'Embedding configuration changed during the operation; retry with the current model'
      )
    }
  }

  public getModelName(): string {
    return this.modelName
  }

  /**
   * 返回索引使用的模型身份；本地模型的下载标识仍由 getModelName 返回。
   *
   * Return the model identity used by indexes. getModelName still returns the download identifier
   * for local models.
   */
  public getIndexIdentity(): string {
    return this.identity
  }

  public isRemote(): boolean {
    return this.kind === 'remote'
  }

  /**
   * 在嵌入前按当前远程输入预算展开正文块，保留原文和调用方附带的页码等信息。
   * 本地模型保持既有切分；预算变化由索引身份隔离，不能复用不同切分规则的向量缓存。
   *
   * Expand document chunks within the current remote input budget while retaining the original
   * text and caller metadata such as page numbers. Local splitting is unchanged; index identity
   * separates budget policies so vector caches cannot cross incompatible chunk layouts.
   */
  public prepareDocumentChunks<T extends { text: string }>(chunks: T[]): T[] {
    const maxInputTokens = this.maxInputTokens
    if (maxInputTokens === undefined) return chunks
    return chunks.flatMap((chunk) =>
      splitEmbeddingText(chunk.text, maxInputTokens).map((text) => ({ ...chunk, text }))
    )
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
    const version = this.configurationVersion
    if (this.status === 'ready') return
    if (!this.initializationPromise) {
      this.status = 'initializing'
      this.initializationPromise = this.initializeExecutor(this.executor, version)
    }

    const initialization = this.initializationPromise
    try {
      await initialization
      this.assertConfiguration(version)
    } catch (error) {
      this.assertConfiguration(version)
      throw error
    } finally {
      if (version === this.configurationVersion && this.initializationPromise === initialization) {
        this.initializationPromise = null
      }
    }
  }

  private async initializeExecutor(executor: EmbeddingExecutor, version: number): Promise<void> {
    try {
      await executor.initialize()
      this.assertConfiguration(version)
      this.status = 'ready'
    } catch (error) {
      this.assertConfiguration(version)
      this.status = 'error'
      throw new Error(toEmbeddingInitializationMessage(error), {
        cause: error instanceof Error ? error : undefined
      })
    }
  }

  public async embed(texts: string | string[]): Promise<EmbeddingResult> {
    const version = this.configurationVersion
    const executor = this.executor
    const identity = this.identity
    try {
      if (this.status !== 'ready') {
        await this.initialize()
      }
      this.assertConfiguration(version)
      if (this.status !== 'ready') {
        throw new Error(
          `EmbeddingService initialization ended in unexpected status: ${this.status}`
        )
      }
      const inputTexts = Array.isArray(texts) ? texts : [texts]
      const result = await executor.embed(inputTexts)
      this.assertConfiguration(version)
      return { ...result, modelIdentity: identity }
    } catch (error) {
      this.assertConfiguration(version)
      throw error
    }
  }

  public async applyIndexSpeed(speed: KnowledgeIndexSpeed): Promise<void> {
    await this.applyThreadBudget(resolveOrtThreadBudget(speed))
  }

  public async applyThreadBudget(budget: EmbeddingThreadBudget): Promise<void> {
    if (this.isRemote()) return
    const version = this.configurationVersion
    const executor = this.executor
    try {
      executor.setThreadBudget?.(budget)
      await executor.restart?.()
      this.assertConfiguration(version)
      this.status = 'uninitialized'
    } catch (error) {
      this.assertConfiguration(version)
      throw error
    }
  }

  public async close(): Promise<void> {
    const version = this.configurationVersion
    const executor = this.executor
    try {
      await executor.cancelPending?.()
      await this.initializationPromise?.catch(() => undefined)
      this.assertConfiguration(version)
      await executor.close?.()
      this.assertConfiguration(version)
      this.status = 'uninitialized'
    } catch (error) {
      this.assertConfiguration(version)
      throw error
    }
  }

  public async reset(): Promise<void> {
    const version = this.configurationVersion
    const executor = this.executor
    try {
      await this.initializationPromise?.catch(() => undefined)
      this.assertConfiguration(version)
      if (executor.restart) await executor.restart()
      else await executor.close?.()
      this.assertConfiguration(version)
      this.status = 'uninitialized'
    } catch (error) {
      this.assertConfiguration(version)
      throw error
    }
  }
}
