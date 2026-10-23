import { createHash, randomUUID } from 'node:crypto'
import type {
  EmbeddingModelSettings,
  EmbeddingModelsSnapshot,
  RemoteEmbeddingModel,
  RemoteEmbeddingModelInput
} from '../../../shared/embeddingModels'
import {
  LOCAL_EMBEDDING_MODEL_ID,
  defaultEmbeddingInputTokens,
  embeddingInputBudget,
  EMBEDDING_INPUT_POLICY_VERSION
} from '../../../shared/embeddingModels'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import type { EmbeddingSettingsStore } from '../storage/domains/EmbeddingSettingsStore'
import { DEFAULT_EMBEDDING_MODEL_NAME, type EmbeddingService } from './EmbeddingService'
import type { EmbeddingExecutor } from './runtime/types'
import { RemoteEmbeddingExecutor, resolveEmbeddingUrl } from './runtime/RemoteEmbeddingExecutor'
import { ensureEmbeddingReady } from './ensureEmbeddingReady'
import type { KnowledgeIndexSpeed } from '../../../shared/types'
import { createWorkspaceEmbeddingBatches } from '../workspace/utils/knowledge'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim())
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('请填写不含凭据、查询参数或片段的 HTTP API 地址。')
  }
  return url.href.replace(/\/+$/, '')
}

export function remoteEmbeddingIdentity(
  model: Pick<RemoteEmbeddingModel, 'baseUrl' | 'modelName' | 'maxInputTokens'>
): string {
  const endpoint = resolveEmbeddingUrl(normalizeBaseUrl(model.baseUrl))
  return `remote:${createHash('sha256')
    .update(
      JSON.stringify([
        endpoint,
        model.modelName.trim(),
        model.maxInputTokens ?? defaultEmbeddingInputTokens(model.modelName),
        EMBEDDING_INPUT_POLICY_VERSION
      ])
    )
    .digest('hex')}`
}

/**
 * 模型设置立即生效；每份资料的模型标记同时作为可恢复任务进度，旧文本继续用于读取和关键词检索。
 *
 * Model settings take effect immediately. Per-document model markers persist resumable progress while old text remains readable and searchable by keyword.
 */
export class EmbeddingModelService {
  private settings: EmbeddingModelSettings
  private running: Promise<void> | null = null
  private mutations: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private revision = 0
  private lastError: string | undefined

  public constructor(
    private readonly deps: {
      settingsStore: EmbeddingSettingsStore
      documentsStore: DocumentsStore
      embeddingService: EmbeddingService
      createLocalExecutor: () => EmbeddingExecutor | Promise<EmbeddingExecutor>
    }
  ) {
    const settings = deps.settingsStore.get()
    this.settings = {
      ...settings,
      remoteModels: settings.remoteModels.map((model) => ({
        ...model,
        maxInputTokens: model.maxInputTokens ?? defaultEmbeddingInputTokens(model.modelName)
      }))
    }
  }

  public async initialize(): Promise<void> {
    await this.applyActiveModel()
    this.schedule()
    this.timer = setInterval(() => this.schedule(), 5_000)
    this.timer.unref()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation)
    this.mutations = result.catch(() => undefined)
    return result
  }

  private getRemote(id = this.settings.activeModelId): RemoteEmbeddingModel {
    const model = this.settings.remoteModels.find((entry) => entry.id === id)
    if (!model) throw new Error('远程向量模型不存在，请重新选择。')
    return model
  }

  private async applyActiveModel(): Promise<void> {
    this.revision += 1
    this.lastError = undefined
    const { embeddingService } = this.deps
    if (this.settings.activeModelId === LOCAL_EMBEDDING_MODEL_ID) {
      await embeddingService.configure({
        executor: await this.deps.createLocalExecutor(),
        modelName: DEFAULT_EMBEDDING_MODEL_NAME,
        identity: LOCAL_EMBEDDING_MODEL_ID,
        kind: 'local'
      })
    } else {
      const model = this.getRemote()
      await embeddingService.configure({
        executor: new RemoteEmbeddingExecutor(model),
        modelName: model.modelName,
        identity: remoteEmbeddingIdentity(model),
        kind: 'remote',
        maxInputTokens: model.maxInputTokens
      })
    }
  }

  private validateRemote(input: RemoteEmbeddingModelInput): RemoteEmbeddingModel {
    if (!input || typeof input !== 'object') throw new Error('远程向量模型配置无效。')
    const previous = input.id ? this.getRemote(input.id) : undefined
    if (typeof input.name !== 'string' || !input.name.trim())
      throw new Error('请填写模型显示名称。')
    if (typeof input.modelName !== 'string' || !input.modelName.trim())
      throw new Error('请填写 Embedding 模型名称。')
    if (typeof input.baseUrl !== 'string') throw new Error('请填写 API 地址。')
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string')
      throw new Error('API Key 无效。')
    const apiKey = input.apiKey?.trim() || previous?.apiKey || ''
    if (!apiKey) throw new Error('请填写 API Key。')
    const maxInputTokens =
      input.maxInputTokens ??
      previous?.maxInputTokens ??
      defaultEmbeddingInputTokens(input.modelName)
    embeddingInputBudget(maxInputTokens)
    return {
      id: previous?.id ?? `remote:${randomUUID()}`,
      name: input.name.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      modelName: input.modelName.trim(),
      apiKey,
      maxInputTokens
    }
  }

  public async saveRemote(input: RemoteEmbeddingModelInput): Promise<EmbeddingModelsSnapshot> {
    return this.serialize(async () => {
      const model = this.validateRemote(input)
      const previous = this.settings.remoteModels.find((entry) => entry.id === model.id)
      const changesVectors =
        !previous || remoteEmbeddingIdentity(previous) !== remoteEmbeddingIdentity(model)
      const entries = this.settings.remoteModels.filter((entry) => entry.id !== model.id)
      this.settings = { ...this.settings, remoteModels: [...entries, model] }
      this.deps.settingsStore.save(this.settings)
      if (model.id === this.settings.activeModelId) {
        if (changesVectors)
          await this.deps.documentsStore.clearEmbeddingErrors(remoteEmbeddingIdentity(model))
        await this.applyActiveModel()
        this.schedule()
      }
      return this.getSnapshot()
    })
  }

  public async deleteRemote(id: string): Promise<EmbeddingModelsSnapshot> {
    return this.serialize(async () => {
      if (id === this.settings.activeModelId)
        throw new Error('请先切换到其他模型，再删除当前模型。')
      this.getRemote(id)
      this.settings = {
        ...this.settings,
        remoteModels: this.settings.remoteModels.filter((entry) => entry.id !== id)
      }
      this.deps.settingsStore.save(this.settings)
      return this.getSnapshot()
    })
  }

  public async select(id: string): Promise<EmbeddingModelsSnapshot> {
    return this.serialize(async () => {
      if (id !== LOCAL_EMBEDDING_MODEL_ID) this.getRemote(id)
      if (id !== this.settings.activeModelId) {
        this.settings = { ...this.settings, activeModelId: id, indexPaused: false }
        this.deps.settingsStore.save(this.settings)
        await this.applyActiveModel()
        await this.deps.documentsStore.clearEmbeddingErrors(
          this.deps.embeddingService.getIndexIdentity()
        )
        this.schedule()
      }
      return this.getSnapshot()
    })
  }

  public async test(input: RemoteEmbeddingModelInput): Promise<number> {
    const executor = new RemoteEmbeddingExecutor(this.validateRemote(input))
    try {
      await executor.initialize()
      const result = await executor.embed(['test'])
      return result.dims[1]
    } finally {
      await executor.close?.()
    }
  }

  public async applyIndexSpeed(speed: KnowledgeIndexSpeed): Promise<void> {
    return this.serialize(async () => {
      if (this.deps.embeddingService.isRemote()) return
      await this.applyActiveModel()
      await this.deps.embeddingService.applyIndexSpeed(speed)
      this.schedule()
    })
  }

  public async control(action: 'pause' | 'resume' | 'retry'): Promise<EmbeddingModelsSnapshot> {
    return this.serialize(async () => {
      if (!['pause', 'resume', 'retry'].includes(action)) throw new Error('无效的索引任务操作。')
      this.settings = { ...this.settings, indexPaused: action === 'pause' }
      this.deps.settingsStore.save(this.settings)
      this.revision += 1
      this.lastError = undefined
      if (action === 'retry')
        await this.deps.documentsStore.clearEmbeddingErrors(
          this.deps.embeddingService.getIndexIdentity()
        )
      this.schedule()
      return this.getSnapshot()
    })
  }

  public async getSnapshot(): Promise<EmbeddingModelsSnapshot> {
    const coverage = await this.deps.documentsStore.getEmbeddingCoverage(
      this.deps.embeddingService.getIndexIdentity()
    )
    const error =
      this.lastError ??
      (await this.deps.documentsStore.getEmbeddingError(
        this.deps.embeddingService.getIndexIdentity()
      ))
    const status = this.settings.indexPaused
      ? 'paused'
      : this.running && coverage.pending > 0
        ? 'running'
        : coverage.failed > 0 || this.lastError
          ? 'failed'
          : 'idle'
    return {
      activeModelId: this.settings.activeModelId,
      remoteModels: this.settings.remoteModels.map(({ apiKey, ...model }) => ({
        ...model,
        hasApiKey: Boolean(apiKey)
      })),
      index: { ...coverage, status, ...(error ? { error } : {}) }
    }
  }

  private schedule(): void {
    if (this.stopped || this.running || this.settings.indexPaused || this.lastError) return
    const revision = this.revision
    const running = this.reembed()
    this.running = running
    void running
      .catch((error) => {
        if (revision === this.revision) this.lastError = errorMessage(error)
      })
      .finally(() => {
        if (this.running === running) this.running = null
        if (revision !== this.revision && !this.stopped) this.schedule()
      })
  }

  private async reembed(): Promise<void> {
    const { documentsStore, embeddingService } = this.deps
    const revision = this.revision
    const identity = embeddingService.getIndexIdentity()
    const isCurrent = (): boolean =>
      !this.stopped &&
      !this.settings.indexPaused &&
      revision === this.revision &&
      identity === embeddingService.getIndexIdentity()
    const documents = await documentsStore.listPendingEmbeddingDocuments(identity)
    for (const document of documents) {
      if (!isCurrent()) return
      try {
        const current = await documentsStore.getDocumentById(document.id)
        if (
          !current ||
          current.active_generation_id !== document.generationId ||
          (current.content_hash ?? '') !== document.contentHash
        )
          continue
        const sourceChunks = await documentsStore.getDocumentEmbeddingChunks(document.id)
        if (sourceChunks.some((chunk) => chunk.generation_id !== document.generationId)) continue
        const expanded = embeddingService.prepareDocumentChunks(sourceChunks)
        const changedLayout =
          expanded.length !== sourceChunks.length ||
          expanded.some((chunk, index) => chunk.text !== sourceChunks[index]?.text)
        const targetGenerationId = changedLayout ? randomUUID() : document.generationId
        const chunks = changedLayout
          ? expanded.map((chunk, index) => ({
              ...chunk,
              id: createHash('sha256')
                .update(JSON.stringify([document.id, targetGenerationId, index]))
                .digest('hex'),
              generation_id: targetGenerationId,
              chunk_index: index
            }))
          : sourceChunks
        if (chunks.length > 0) await ensureEmbeddingReady({ embeddingService })
        const vectors: Float32Array[] = []
        for (const batch of createWorkspaceEmbeddingBatches(
          chunks.map((chunk) => ({ text: chunk.text, page: chunk.metadata?.page ?? 1 }))
        )) {
          if (!isCurrent()) return
          const result = await embeddingService.embed(batch.map((chunk) => chunk.text))
          if (!isCurrent() || result.modelIdentity !== identity) return
          documentsStore.assertEmbeddingDimension(identity, result.dims[1])
          for (let index = 0; index < batch.length; index += 1) {
            vectors.push(result.data.slice(index * result.dims[1], (index + 1) * result.dims[1]))
          }
        }
        if (!isCurrent()) return
        await documentsStore.replaceDocumentEmbeddings({
          documentId: document.id,
          generationId: document.generationId,
          targetGenerationId,
          contentHash: document.contentHash,
          embeddingIdentity: identity,
          vectors,
          chunks,
          isCurrent
        })
      } catch (error) {
        if (!isCurrent()) return
        const current = await documentsStore.getDocumentById(document.id)
        if (
          !current ||
          current.active_generation_id !== document.generationId ||
          (current.content_hash ?? '') !== document.contentHash
        )
          continue
        const message = errorMessage(error)
        await documentsStore.markDocumentEmbeddingError(document.id, document.generationId, message)
        this.lastError = message
        return
      }
    }
  }

  public async close(): Promise<void> {
    this.stopped = true
    this.revision += 1
    if (this.timer) clearInterval(this.timer)
    await this.mutations
    await this.deps.embeddingService.close()
    await this.running?.catch(() => undefined)
  }
}
