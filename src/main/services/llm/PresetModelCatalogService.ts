import fs from 'fs/promises'
import path from 'path'
import { PRESET_MODELS_CATALOG_URL } from '../../../shared/constants'
import {
  PRESET_MODEL_CATALOG_TTL_MS,
  emptyPresetModelsSnapshot,
  mergePresetCatalogProviders,
  type LlmPresetProvider,
  type PresetCatalogModelPayload,
  type PresetCatalogProviderPayload,
  type PresetModelsCatalogResponse,
  type PresetModelsSnapshot,
  isLlmPresetProviderId
} from '../../../shared/llmPresets'
import { cacheModelIcons, resolveCachedIconUrls } from './modelIconCache'
import { getUserDataPath } from '../../utils/paths'

const CACHE_FILE_NAME = 'preset-models-catalog.json'
const FETCH_TIMEOUT_MS = 15_000

type CachePayload = {
  fetchedAt: number
  updatedAt: string | null
  providers: LlmPresetProvider[]
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const parseRemoteModel = (value: unknown): PresetCatalogModelPayload | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = String(row.id || '').trim()
  const label = String(row.label || '').trim()
  const iconUrl = String(row.iconUrl || '').trim()
  const priceTier = row.priceTier
  if (!id || !label || !iconUrl) return null
  if (priceTier !== 'low' && priceTier !== 'mid' && priceTier !== 'high') return null
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities.filter(
        (item): item is 'text' | 'vision' => item === 'text' || item === 'vision'
      )
    : []
  if (capabilities.length === 0) return null
  return {
    id,
    label,
    iconUrl,
    priceTier,
    description: typeof row.description === 'string' ? row.description.trim() : '',
    capabilities
  }
}

const parseRemoteProvider = (value: unknown): PresetCatalogProviderPayload | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const providerId = String(row.providerId || '').trim()
  if (!isLlmPresetProviderId(providerId) || !Array.isArray(row.models)) return null
  const models: PresetCatalogModelPayload[] = []
  for (const item of row.models) {
    const model = parseRemoteModel(item)
    if (!model) continue
    models.push(model)
  }
  return {
    providerId,
    models
  }
}

const parseResponse = (value: unknown): PresetModelsCatalogResponse | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.providers)) return null
  const remote: PresetCatalogProviderPayload[] = []
  for (const item of row.providers) {
    const parsed = parseRemoteProvider(item)
    if (!parsed) return null
    remote.push(parsed)
  }
  const providers = mergePresetCatalogProviders(remote)
  if (providers.length === 0) return null
  return {
    updatedAt: isNonEmptyString(row.updatedAt) ? row.updatedAt.trim() : new Date().toISOString(),
    providers: providers.map((provider) => ({
      providerId: provider.providerId,
      models: provider.models
    }))
  }
}

export class PresetModelCatalogService {
  private static instance: PresetModelCatalogService | null = null

  private cache: CachePayload | null = null
  private loadPromise: Promise<void> | null = null
  private refreshPromise: Promise<PresetModelsSnapshot> | null = null

  static getInstance(): PresetModelCatalogService {
    if (!this.instance) {
      this.instance = new PresetModelCatalogService()
    }
    return this.instance
  }

  private cachePath(): string {
    return path.join(getUserDataPath(), CACHE_FILE_NAME)
  }

  private collectIconUrls(providers: readonly LlmPresetProvider[]): string[] {
    return providers.flatMap((provider) => provider.models.map((model) => model.iconUrl))
  }

  private async toSnapshot(cache: CachePayload | null): Promise<PresetModelsSnapshot> {
    if (!cache || cache.providers.length === 0) {
      return emptyPresetModelsSnapshot()
    }
    const resolvedIcons = await resolveCachedIconUrls(this.collectIconUrls(cache.providers))
    return {
      updatedAt: cache.updatedAt,
      fetchedAt: cache.fetchedAt,
      providers: cache.providers.map((provider) => ({
        ...provider,
        models: provider.models.map((model) => ({
          ...model,
          iconUrl: resolvedIcons.get(model.iconUrl) || model.iconUrl
        }))
      }))
    }
  }

  private isStale(cache: CachePayload | null, now = Date.now()): boolean {
    if (!cache) return true
    return now - cache.fetchedAt >= PRESET_MODEL_CATALOG_TTL_MS
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache) return
    if (this.loadPromise) {
      await this.loadPromise
      return
    }
    this.loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.cachePath(), 'utf8')
        const parsed = JSON.parse(raw) as Partial<CachePayload>
        if (
          typeof parsed.fetchedAt !== 'number' ||
          !Array.isArray(parsed.providers) ||
          parsed.providers.length === 0
        ) {
          return
        }
        const providers = mergePresetCatalogProviders(
          parsed.providers.map((provider) => ({
            providerId: provider.providerId,
            models: provider.models
          }))
        )
        if (providers.length === 0) return
        this.cache = {
          fetchedAt: parsed.fetchedAt,
          updatedAt: isNonEmptyString(parsed.updatedAt) ? parsed.updatedAt : null,
          providers
        }
      } catch {
        // no cache yet
      }
    })()
    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private async persist(cache: CachePayload): Promise<void> {
    await fs.mkdir(path.dirname(this.cachePath()), { recursive: true })
    await fs.writeFile(this.cachePath(), JSON.stringify(cache), 'utf8')
  }

  private async fetchRemote(): Promise<CachePayload> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(PRESET_MODELS_CATALOG_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      if (!response.ok) {
        throw new Error(`预设模型目录请求失败（HTTP ${response.status}）`)
      }
      const body: unknown = await response.json()
      const parsed = parseResponse(body)
      if (!parsed) {
        throw new Error('预设模型目录数据无效')
      }
      return {
        fetchedAt: Date.now(),
        updatedAt: parsed.updatedAt,
        providers: mergePresetCatalogProviders(parsed.providers)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async getSnapshot(options?: { refreshIfStale?: boolean }): Promise<PresetModelsSnapshot> {
    await this.ensureLoaded()
    if (options?.refreshIfStale && this.isStale(this.cache)) {
      void this.refresh().catch((error) => {
        console.error('[PRESET-MODELS] Background refresh failed', error)
      })
    }
    return await this.toSnapshot(this.cache)
  }

  async refresh(): Promise<PresetModelsSnapshot> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = (async () => {
      await this.ensureLoaded()
      try {
        const next = await this.fetchRemote()
        this.cache = next
        await this.persist(next)
        await cacheModelIcons(this.collectIconUrls(next.providers))
        return await this.toSnapshot(next)
      } catch (error) {
        if (this.cache && this.cache.providers.length > 0) {
          return await this.toSnapshot(this.cache)
        }
        throw error
      }
    })()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }
}
