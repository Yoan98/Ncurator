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
import type { KnowledgeIndexSpeed } from '../../../shared/types'
import type { WorkspaceIndexJobStore } from '../storage/domains/WorkspaceIndexJobStore'

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

/** Model selection invalidates mismatched indexes; only ordinary user-started jobs rebuild them. */
export class EmbeddingModelService {
  private settings: EmbeddingModelSettings
  private mutations: Promise<void> = Promise.resolve()

  public constructor(
    private readonly deps: {
      indexJobStore: Pick<WorkspaceIndexJobStore, 'hasRunningPrepareJob'>
      settingsStore: EmbeddingSettingsStore
      documentsStore: DocumentsStore
      embeddingService: EmbeddingService
      createLocalExecutor: () => EmbeddingExecutor | Promise<EmbeddingExecutor>
    }
  ) {
    const settings = deps.settingsStore.get()
    this.settings = {
      activeModelId: settings.activeModelId,
      remoteModels: settings.remoteModels.map((model) => ({
        ...model,
        maxInputTokens: model.maxInputTokens ?? defaultEmbeddingInputTokens(model.modelName)
      }))
    }
  }

  public async initialize(): Promise<void> {
    await this.applyActiveModel()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation)
    this.mutations = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private getRemote(id = this.settings.activeModelId): RemoteEmbeddingModel {
    const model = this.settings.remoteModels.find((entry) => entry.id === id)
    if (!model) throw new Error('远程向量模型不存在，请重新选择。')
    return model
  }

  private async applyActiveModel(): Promise<void> {
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
      if (model.id === this.settings.activeModelId) await this.assertIndexIdle()
      const entries = this.settings.remoteModels.filter((entry) => entry.id !== model.id)
      this.settings = { ...this.settings, remoteModels: [...entries, model] }
      this.deps.settingsStore.save(this.settings)
      if (model.id === this.settings.activeModelId) await this.applyActiveModel()
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
        await this.assertIndexIdle()
        this.settings = { ...this.settings, activeModelId: id }
        this.deps.settingsStore.save(this.settings)
        await this.applyActiveModel()
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
    })
  }

  public async assertIndexIdle(): Promise<void> {
    if (await this.deps.indexJobStore.hasRunningPrepareJob()) {
      throw new Error(
        'Indexing is in progress. Cancel the current indexing task before changing the embedding model.'
      )
    }
  }

  public async getSnapshot(): Promise<EmbeddingModelsSnapshot> {
    const identity = this.deps.embeddingService.getIndexIdentity()
    const state = this.deps.documentsStore.getEmbeddingIndexState(identity)
    const restoreModelId =
      state.completeIdentity && state.completeIdentity !== identity
        ? state.completeIdentity === LOCAL_EMBEDDING_MODEL_ID
          ? LOCAL_EMBEDDING_MODEL_ID
          : this.settings.remoteModels.find(
              (model) => remoteEmbeddingIdentity(model) === state.completeIdentity
            )?.id
        : undefined
    return {
      activeModelId: this.settings.activeModelId,
      remoteModels: this.settings.remoteModels.map(({ apiKey, ...model }) => ({
        ...model,
        hasApiKey: Boolean(apiKey)
      })),
      index: {
        staleFileCount: state.staleFileCount,
        staleWebCount: state.staleWebCount,
        running: await this.deps.indexJobStore.hasRunningPrepareJob(),
        ...(restoreModelId ? { restoreModelId } : {})
      }
    }
  }

  public async close(): Promise<void> {
    await this.mutations
    await this.deps.embeddingService.close()
  }
}
