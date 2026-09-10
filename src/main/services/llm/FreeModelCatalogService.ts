import fs from 'fs/promises'
import path from 'path'
import { FREE_MODELS_CATALOG_URL } from '../../../shared/constants'
import {
  FREE_MODEL_CATALOG_TTL_MS,
  type FreeModelCatalogEntry,
  type FreeModelsCatalogResponse,
  type FreeModelsSnapshot,
  freeModelEntryIdFromConfigId,
  toFreeModelPublicEntry,
  toFreeModelRuntimeConfig,
  type FreeModelPublicEntry
} from '../../../shared/freeModels'
import type { LlmRuntimeConfig } from '../../../shared/types'
import { getUserDataPath } from '../../utils/paths'

const FREE_MODELS_ENDPOINT = FREE_MODELS_CATALOG_URL
const CACHE_FILE_NAME = 'free-models-catalog.json'
const FETCH_TIMEOUT_MS = 15_000

type CachePayload = {
  fetchedAt: number
  updatedAt: string | null
  models: FreeModelCatalogEntry[]
}

const PROVIDER_IDS = new Set(['deepseek', 'dashscope', 'mimo', 'moonshot', 'zhipu'])
const PROVIDER_KINDS = new Set(['openai', 'deepseek', 'openai-compatible'])
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
  const providerId = String(row.providerId || '').trim()
  const providerKind = String(row.providerKind || '').trim()
  const modelName = String(row.modelName || '').trim()
  const label = String(row.label || '').trim()
  const description = String(row.description || '').trim()
  const iconUrl = String(row.iconUrl || '').trim()
  const baseUrl = String(row.baseUrl || '').trim()
  const apiKey = String(row.apiKey || '').trim()
  const capabilities = parseCapabilities(row.capabilities)
  if (
    !id ||
    !PROVIDER_IDS.has(providerId) ||
    !PROVIDER_KINDS.has(providerKind) ||
    !modelName ||
    !label ||
    !description ||
    !iconUrl ||
    !baseUrl ||
    !apiKey ||
    !capabilities
  ) {
    return null
  }
  return {
    id,
    providerId: providerId as FreeModelCatalogEntry['providerId'],
    providerKind: providerKind as FreeModelCatalogEntry['providerKind'],
    modelName,
    label,
    description,
    capabilities,
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
  private static instance: FreeModelCatalogService | null = null

  private cache: CachePayload | null = null
  private loadPromise: Promise<void> | null = null
  private refreshPromise: Promise<FreeModelsSnapshot> | null = null

  static getInstance(): FreeModelCatalogService {
    if (!this.instance) {
      this.instance = new FreeModelCatalogService()
    }
    return this.instance
  }

  private cachePath(): string {
    return path.join(getUserDataPath(), CACHE_FILE_NAME)
  }

  private toSnapshot(cache: CachePayload | null): FreeModelsSnapshot {
    if (!cache) {
      return { updatedAt: null, fetchedAt: null, models: [] }
    }
    return {
      updatedAt: cache.updatedAt,
      fetchedAt: cache.fetchedAt,
      models: cache.models.map(toFreeModelPublicEntry)
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
      try {
        const raw = await fs.readFile(this.cachePath(), 'utf8')
        const parsed = JSON.parse(raw) as Partial<CachePayload>
        if (
          typeof parsed.fetchedAt !== 'number' ||
          !Array.isArray(parsed.models) ||
          parsed.models.length === 0
        ) {
          return
        }
        const models: FreeModelCatalogEntry[] = []
        for (const item of parsed.models) {
          const entry = parseEntry(item)
          if (!entry) return
          models.push(entry)
        }
        this.cache = {
          fetchedAt: parsed.fetchedAt,
          updatedAt: isNonEmptyString(parsed.updatedAt) ? parsed.updatedAt : null,
          models
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
      const response = await fetch(FREE_MODELS_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      if (!response.ok) {
        throw new Error(`免费模型目录请求失败（HTTP ${response.status}）`)
      }
      const body: unknown = await response.json()
      const parsed = parseResponse(body)
      if (!parsed) {
        throw new Error('免费模型目录数据无效')
      }
      return {
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
    const snapshot = this.toSnapshot(this.cache)
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
      return this.toSnapshot(next)
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

  async resolveRuntimeConfig(
    configId: string,
    modelName: string
  ): Promise<LlmRuntimeConfig | null> {
    await this.ensureLoaded()
    const entryId = freeModelEntryIdFromConfigId(configId)
    if (!entryId) return null
    const entry = this.cache?.models.find((item) => item.id === entryId)
    if (!entry) return null
    const requestedName = String(modelName || '').trim()
    if (requestedName && requestedName !== entry.modelName) {
      return toFreeModelRuntimeConfig(entry, requestedName)
    }
    return toFreeModelRuntimeConfig(entry)
  }
}
