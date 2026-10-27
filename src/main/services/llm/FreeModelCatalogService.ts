import { getAppRuntime } from '../app/AppRuntime'
import {
  officialUrl,
  routeForOfficialUrl,
  type AppRuntimeSnapshot
} from '../../../shared/appPreferences'
import fs from 'fs/promises'
import path from 'path'
import {
  FREE_MODEL_CATALOG_TTL_MS,
  FREE_MODEL_CATALOG_CACHE_VERSION,
  isFreeModelApiUrl,
  parseCatalogContextWindowTokens,
  type FreeModelCatalogEntry,
  type FreeModelsCatalogResponse,
  type FreeModelsSnapshot,
  freeModelEntryIdFromConfigId,
  toFreeModelPublicEntry,
  toFreeModelRuntimeConfig,
  type FreeModelPublicEntry
} from '../../../shared/freeModels'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { cacheModelIcons, resolveCachedIconUrls } from './modelIconCache'
import { getUserDataPath } from '../../utils/paths'
import { buildDesktopAppGatewayHeaders } from '../officialApi/appClient'
import { ensureFreeModelToken, readJwtExpiryMs } from '../officialApi/freeModelToken'

const CACHE_FILE_NAME = 'free-models-catalog.json'
const FETCH_TIMEOUT_MS = 15_000

type CachePayload = {
  schemaVersion: number
  fetchedAt: number
  updatedAt: string | null
  models: FreeModelCatalogEntry[]
}

const PROVIDER_KINDS = new Set(['openai-compatible'])
const CAPABILITIES = new Set(['text', 'vision'])

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const parseCapabilities = (value: unknown): FreeModelCatalogEntry['capabilities'] | null => {
  if (!Array.isArray(value) || value.length === 0) return null
  const capabilities: FreeModelCatalogEntry['capabilities'] = []
  for (const item of value) {
    if (typeof item !== 'string' || !CAPABILITIES.has(item)) return null
    if (!capabilities.includes(item as 'text' | 'vision')) {
      capabilities.push(item as 'text' | 'vision')
    }
  }
  return capabilities.length > 0 ? capabilities : null
}

const parseEntry = (value: unknown): FreeModelCatalogEntry | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = String(row.id || '').trim()
  const providerKind = String(row.providerKind || '').trim()
  const modelName = String(row.modelName || '').trim()
  const label = String(row.label || '').trim()
  const description = typeof row.description === 'string' ? row.description.trim() : ''
  const iconUrl = String(row.iconUrl || '').trim()
  const baseUrl = String(row.baseUrl || '').trim()
  const apiKey = String(row.apiKey || '').trim()
  const capabilities = parseCapabilities(row.capabilities)
  if (
    !id ||
    !PROVIDER_KINDS.has(providerKind) ||
    !modelName ||
    !label ||
    !iconUrl ||
    !isFreeModelApiUrl(baseUrl) ||
    readJwtExpiryMs(apiKey) === null ||
    !capabilities
  ) {
    return null
  }
  return {
    id,
    providerKind: providerKind as FreeModelCatalogEntry['providerKind'],
    modelName,
    label,
    description,
    capabilities,
    contextWindowTokens: parseCatalogContextWindowTokens(row.contextWindowTokens),
    iconUrl,
    baseUrl,
    apiKey
  }
}

const parseResponse = (value: unknown): FreeModelsCatalogResponse | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.models)) return null
  const models: FreeModelCatalogEntry[] = []
  for (const item of row.models) {
    const parsed = parseEntry(item)
    if (!parsed) return null
    models.push(parsed)
  }
  return {
    updatedAt: isNonEmptyString(row.updatedAt) ? row.updatedAt.trim() : new Date().toISOString(),
    models
  }
}

export class FreeModelCatalogService {
  private static instances = new Map<string, FreeModelCatalogService>()

  public constructor(
    private readonly context: Readonly<AppRuntimeSnapshot> = { ...getAppRuntime() }
  ) {}

  private cache: CachePayload | null = null
  private loadPromise: Promise<void> | null = null
  private refreshPromise: Promise<FreeModelsSnapshot> | null = null

  static getInstance(): FreeModelCatalogService {
    const context = { ...getAppRuntime() }
    const key = `${context.serviceRoute}-${context.locale}`
    let instance = this.instances.get(key)
    if (!instance) {
      instance = new FreeModelCatalogService(context)
      this.instances.set(key, instance)
    }
    return instance
  }

  private resolveIconUrl(value: string): string {
    if (!routeForOfficialUrl(value)) return value
    const url = new URL(value)
    return officialUrl(this.context.serviceRoute, `${url.pathname}${url.search}`)
  }

  private cachePath(): string {
    return path.join(
      getUserDataPath(),
      `${this.context.serviceRoute}-${this.context.locale}-${CACHE_FILE_NAME}`
    )
  }

  private async toSnapshot(cache: CachePayload | null): Promise<FreeModelsSnapshot> {
    if (!cache) {
      return { updatedAt: null, fetchedAt: null, models: [] }
    }
    const resolvedIcons = await resolveCachedIconUrls(cache.models.map((item) => item.iconUrl))
    return {
      updatedAt: cache.updatedAt,
      fetchedAt: cache.fetchedAt,
      models: cache.models.map((entry) => {
        const publicEntry = toFreeModelPublicEntry(entry)
        return {
          ...publicEntry,
          iconUrl: resolvedIcons.get(entry.iconUrl) || entry.iconUrl
        }
      })
    }
  }

  private isStale(cache: CachePayload | null, now = Date.now()): boolean {
    if (!cache) return true
    return now - cache.fetchedAt >= FREE_MODEL_CATALOG_TTL_MS
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache) return
    if (this.loadPromise) {
      await this.loadPromise
      return
    }
    this.loadPromise = (async () => {
      // Unscoped catalogs cannot identify their credential issuer and must never be reused.
      await fs.rm(path.join(getUserDataPath(), CACHE_FILE_NAME), { force: true })
      try {
        const raw = await fs.readFile(this.cachePath(), 'utf8')
        const parsed = JSON.parse(raw) as Partial<CachePayload>
        if (
          parsed.schemaVersion !== FREE_MODEL_CATALOG_CACHE_VERSION ||
          typeof parsed.fetchedAt !== 'number' ||
          !Array.isArray(parsed.models)
        ) {
          throw new Error('免费模型缓存版本无效')
        }
        const models: FreeModelCatalogEntry[] = []
        for (const item of parsed.models) {
          const entry = parseEntry(item)
          if (!entry) throw new Error('免费模型缓存无效')
          models.push(entry)
        }
        this.cache = {
          schemaVersion: FREE_MODEL_CATALOG_CACHE_VERSION,
          fetchedAt: parsed.fetchedAt,
          updatedAt: isNonEmptyString(parsed.updatedAt) ? parsed.updatedAt : null,
          models
        }
      } catch {
        await fs.rm(this.cachePath(), { force: true }).catch(() => undefined)
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
      const response = await fetch(officialUrl(this.context.serviceRoute, '/api/v1/free-models'), {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Accept-Language': this.context.locale,
          ...buildDesktopAppGatewayHeaders({
            method: 'GET',
            url: officialUrl(this.context.serviceRoute, '/api/v1/free-models'),
            body: ''
          })
        },
        signal: controller.signal
      })
      if (!response.ok) {
        const body = await response.text()
        throw new Error(
          [`HTTP ${response.status} ${response.statusText}`.trim(), body]
            .filter(Boolean)
            .join('\n\n')
        )
      }
      const body: unknown = await response.json()
      const parsed = parseResponse(body)
      if (parsed)
        parsed.models = parsed.models.map((model) => ({
          ...model,
          baseUrl: officialUrl(this.context.serviceRoute, '/api/v1/free'),
          iconUrl: this.resolveIconUrl(model.iconUrl)
        }))
      if (!parsed) {
        throw new Error('免费模型目录数据无效')
      }
      return {
        schemaVersion: FREE_MODEL_CATALOG_CACHE_VERSION,
        fetchedAt: Date.now(),
        updatedAt: parsed.updatedAt,
        models: parsed.models
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async getSnapshot(options?: { refreshIfStale?: boolean }): Promise<FreeModelsSnapshot> {
    await this.ensureLoaded()
    const snapshot = await this.toSnapshot(this.cache)
    if (options?.refreshIfStale && this.isStale(this.cache)) {
      void this.refresh().catch((error) => {
        console.error('[FREE-MODELS] Background refresh failed:', error)
      })
    }
    return snapshot
  }

  async refresh(): Promise<FreeModelsSnapshot> {
    if (this.refreshPromise) return await this.refreshPromise
    this.refreshPromise = (async () => {
      await this.ensureLoaded()
      const next = await this.fetchRemote()
      this.cache = next
      await this.persist(next)
      await cacheModelIcons(next.models.map((item) => item.iconUrl))
      return await this.toSnapshot(next)
    })()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  listPublicModels(): FreeModelPublicEntry[] {
    return this.cache?.models.map(toFreeModelPublicEntry) || []
  }

  findEntryById(entryId: string): FreeModelCatalogEntry | null {
    const id = String(entryId || '').trim()
    if (!id) return null
    return this.cache?.models.find((item) => item.id === id) || null
  }

  async resolveRuntimeConfig(
    configId: string,
    modelName: string
  ): Promise<LlmRuntimeConfig | null> {
    await this.ensureLoaded()
    if (!this.cache) await this.refresh()
    const entryId = freeModelEntryIdFromConfigId(configId)
    if (!entryId) return null
    const entry = this.cache?.models.find((item) => item.id === entryId)
    if (!entry) return null
    if (modelName.trim() !== entry.modelName) return null
    const runtime = toFreeModelRuntimeConfig(entry)
    const token = await ensureFreeModelToken(entry.apiKey, this.context.serviceRoute)
    return { ...runtime, api_key: token }
  }
}
