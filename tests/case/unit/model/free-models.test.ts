import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  isFreeModelConfigId,
  isFreeModelApiUrl,
  FREE_MODEL_CATALOG_CACHE_VERSION,
  toFreeModelConfigId,
  toFreeModelPublicEntry,
  type FreeModelCatalogEntry
} from '../../../../src/shared/freeModels'
import { FreeModelCatalogService } from '../../../../src/main/services/llm/FreeModelCatalogService'

const sampleEntry = (overrides?: Partial<FreeModelCatalogEntry>): FreeModelCatalogEntry => ({
  id: 'free-glm-4.7-flash',
  providerKind: 'openai-compatible',
  modelName: 'glm-4.7-flash',
  label: 'GLM-4.7 Flash',
  description: '智谱免费主力：更强工具协同与长任务，高峰可能排队。',
  capabilities: ['text'],
  iconUrl: 'https://www.guanzhangai.cn/llm/zhipu.png',
  baseUrl: 'https://www.guanzhangai.cn/api/v1/free',
  apiKey: 'zhipu-test',
  ...overrides
})

describe('free catalog cache protocol', () => {
  it.each([
    {
      label: 'unversioned direct catalog',
      schemaVersion: undefined,
      credential: 'old-provider-key'
    },
    {
      label: 'upstream key in a versioned catalog',
      schemaVersion: FREE_MODEL_CATALOG_CACHE_VERSION,
      credential: 'old-provider-key'
    }
  ])(
    'discards $label instead of exposing or reusing its credentials',
    async ({ schemaVersion, credential }) => {
      const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-free-cache-'))
      vi.stubEnv('NCURATOR_USER_DATA_PATH', folder)
      try {
        const cachePath = path.join(folder, 'domestic-zh-CN-free-models-catalog.json')
        await fs.writeFile(
          cachePath,
          JSON.stringify({
            schemaVersion,
            fetchedAt: Date.now(),
            models: [sampleEntry({ apiKey: credential })]
          })
        )
        const service = new FreeModelCatalogService()
        expect((await service.getSnapshot()).models).toEqual([])
        await expect(fs.access(cachePath)).rejects.toThrow()
      } finally {
        vi.unstubAllEnvs()
        await fs.rm(folder, { recursive: true, force: true })
      }
    }
  )

  it('loads current credentials and only resolves the exact catalog model name', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-free-cache-'))
    vi.stubEnv('NCURATOR_USER_DATA_PATH', folder)
    const credential = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5400 })).toString('base64url')}.signature`
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const entry = sampleEntry({ apiKey: credential })
      await fs.writeFile(
        path.join(folder, 'domestic-zh-CN-free-models-catalog.json'),
        JSON.stringify({
          schemaVersion: FREE_MODEL_CATALOG_CACHE_VERSION,
          fetchedAt: Date.now(),
          models: [entry]
        })
      )
      const service = new FreeModelCatalogService()
      const snapshot = await service.getSnapshot()
      expect(snapshot.models).toHaveLength(1)
      expect(snapshot.models[0]).not.toHaveProperty('apiKey')
      expect(
        await service.resolveRuntimeConfig(toFreeModelConfigId(entry.id), 'arbitrary-model')
      ).toBeNull()
      expect(
        await service.resolveRuntimeConfig(toFreeModelConfigId(entry.id), entry.modelName)
      ).toMatchObject({ model_name: entry.modelName, api_key: credential })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      await fs.rm(folder, { recursive: true, force: true })
    }
  })
})

describe('free model catalog helpers', () => {
  it('builds synthetic config ids and strips secrets for renderer', () => {
    const entry = sampleEntry()
    expect(toFreeModelConfigId(entry.id)).toBe('free:free-glm-4.7-flash')
    expect(isFreeModelConfigId('free:free-glm-4.7-flash')).toBe(true)
    expect(isFreeModelConfigId('user-config')).toBe(false)

    const publicEntry = toFreeModelPublicEntry(entry)
    expect(publicEntry.configId).toBe('free:free-glm-4.7-flash')
    expect(publicEntry).not.toHaveProperty('apiKey')
    expect(publicEntry).not.toHaveProperty('providerId')
    expect(publicEntry.iconUrl).toBe(entry.iconUrl)
  })

  it('keeps catalog context window tokens on public entries', () => {
    const entry = sampleEntry({ contextWindowTokens: 128000 })
    expect(toFreeModelPublicEntry(entry).contextWindowTokens).toBe(128000)
  })

  it('only recognizes the official free API namespace', () => {
    expect(isFreeModelApiUrl('https://www.guanzhangai.cn/api/v1/free')).toBe(true)
    expect(isFreeModelApiUrl('https://www.guanzhangai.cn/api/v1/free/chat/completions')).toBe(true)
    expect(isFreeModelApiUrl('https://example.com/api/v1/free/chat/completions')).toBe(false)
    expect(isFreeModelApiUrl('https://www.guanzhangai.cn/api/v1/freeload')).toBe(false)
    expect(isFreeModelApiUrl('invalid-url')).toBe(false)
  })
})
