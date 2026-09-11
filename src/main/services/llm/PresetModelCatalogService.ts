import fs from 'fs/promises'
import path from 'path'
import { PRESET_MODELS_CATALOG_URL } from '../../../shared/constants'
import {
  PRESET_MODEL_CATALOG_TTL_MS,
  emptyPresetModelsSnapshot,
  mergePresetCatalogProviders,
  type LlmPresetProvider,
  type PresetCatalogProviderPayload,
  type PresetModelsCatalogResponse,
  type PresetModelsSnapshot,
  isLlmPresetProviderId
} from '../../../shared/llmPresets'
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

const parseRemoteProvider = (value: unknown): PresetCatalogProviderPayload | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const providerId = String(row.providerId || '').trim()
  if (!isLlmPresetProviderId(providerId) || !Array.isArray(row.models)) return null
  return {
    providerId,
    models: row.models as PresetCatalogProviderPayload['models']
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

  private toSnapshot(cache: CachePayload | null): PresetModelsSnapshot {
    if (!cache || cache.providers.length === 0) {
      return emptyPresetModelsSnapshot()
    }
    return {
      updatedAt: cache.updatedAt,
      fetchedAt: cache.fetchedAt,
      providers: cache.providers
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
    return this.toSnapshot(this.cache)
  }

  async refresh(): Promise<PresetModelsSnapshot> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = (async () => {
      await this.ensureLoaded()
      try {
        const next = await this.fetchRemote()
        this.cache = next
        await this.persist(next)
        return this.toSnapshot(next)
      } catch (error) {
        if (this.cache && this.cache.providers.length > 0) {
          return this.toSnapshot(this.cache)
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
