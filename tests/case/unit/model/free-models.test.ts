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
import { PresetModelCatalogService } from '../../../../src/main/services/llm/PresetModelCatalogService'

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

describe('catalog refresh failures', () => {
  it.each(['free', 'preset'] as const)(
    'reports the %s catalog HTTP error even when a cached list exists',
    async (kind) => {
      const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-catalog-error-'))
      vi.stubEnv('NCURATOR_USER_DATA_PATH', folder)
      const body = JSON.stringify({ error: { message: 'Catalog gateway unavailable' } })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(body, {
            status: 503,
            statusText: 'Service Unavailable'
          })
        )
      )
      try {
        const fetchedAt = Date.now()
        const credential = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5400 })).toString('base64url')}.signature`
        const payload =
          kind === 'free'
            ? {
                schemaVersion: FREE_MODEL_CATALOG_CACHE_VERSION,
                fetchedAt,
                models: [sampleEntry({ apiKey: credential })]
              }
            : {
                fetchedAt,
                providers: [
                  {
                    providerId: 'deepseek',
                    models: [
                      {
                        id: 'deepseek-flash',
                        label: 'DeepSeek Flash',
                        iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png',
                        priceTier: 'low',
                        description: '',
                        capabilities: ['text']
                      }
                    ]
                  }
                ]
              }
        await fs.writeFile(
          path.join(
            folder,
            `domestic-zh-CN-${kind === 'free' ? 'free' : 'preset'}-models-catalog.json`
          ),
          JSON.stringify(payload)
        )
        const service =
          kind === 'free' ? new FreeModelCatalogService() : new PresetModelCatalogService()
        const snapshot = await service.getSnapshot()
        expect(snapshot.fetchedAt).toBe(fetchedAt)

        await expect(service.refresh()).rejects.toThrow(`HTTP 503 Service Unavailable\n\n${body}`)
        expect(await service.getSnapshot()).toEqual(snapshot)
      } finally {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
        await fs.rm(folder, { recursive: true, force: true })
      }
    }
  )
})

describe('自定义内置型号目录', () => {
  it('国内包只匹配内置服务商，保留精确调用名，并接受服务端主动清空目录', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-custom-catalog-'))
    vi.stubEnv('NCURATOR_USER_DATA_PATH', folder)
    vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'test-domestic-catalog-app-key')
    const catalogPath = 'https://www.guanzhangai.cn/api/v1/model-catalog'
    const row = {
      kind: 'custom',
      id: '9007199254740993',
      modelName: 'example/Case-Sensitive',
      providerKey: 'deepseek',
      label: '示例型号',
      priceTier: 'low',
      description: null,
      contextWindowTokens: 4096,
      capabilities: ['text'],
      iconUrl: 'https://www.guanzhangai.cn/llm/deepseek.png'
    }
    let models: object[] = [
      row,
      { ...row, id: '2', providerKey: 'unknown-provider' },
      { ...row, id: '3', kind: 'free' },
      { ...row, id: '4', kind: 'managed', privateCredential: 'fixture-private-field' }
    ]
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === catalogPath
          ? Response.json({ protocolVersion: 1, revision: 'a'.repeat(64), models })
          : new Response(null, { status: 404 })
      )
    vi.stubGlobal('fetch', request)
    try {
      const service = new PresetModelCatalogService()
      const snapshot = await service.refresh()
      const call = request.mock.calls.find(([url]) => url === catalogPath)
      expect(call).toBeDefined()
      const headers = new Headers(call?.[1]?.headers)
      expect(headers.get('x-ncurator-signature')).toMatch(/^[a-f0-9]{64}$/)
      expect(headers.has('authorization')).toBe(false)
      expect(snapshot.providers.map((p) => p.providerId)).toEqual(['deepseek'])
      expect(snapshot.providers[0].models.map((model) => model.id)).toEqual([row.modelName])
      expect(service.findModelById(row.id)).toBeNull()
      expect(service.findModelById(row.modelName)).toMatchObject({ contextWindowTokens: 4096 })
      expect(JSON.stringify(snapshot)).not.toMatch(/fixture-private-field|unknown-provider/)

      models = []
      const empty = await service.refresh()
      expect(empty.fetchedAt).toBeTypeOf('number')
      expect(empty.providers).toEqual([])
      expect((await new PresetModelCatalogService().getSnapshot()).fetchedAt).toBe(empty.fetchedAt)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      await fs.rm(folder, { recursive: true, force: true })
    }
  })

  it('海外包继续读取自身的旧目录，不请求国内接口', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-global-catalog-'))
    vi.stubEnv('NCURATOR_USER_DATA_PATH', folder)
    vi.stubEnv('NCURATOR_DISTRIBUTION', 'international')
    vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'test-overseas-catalog-app-key')
    vi.resetModules()
    const catalogPath = 'https://www.ncurator.com/api/v1/preset-models'
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      url === catalogPath
        ? Response.json({
            providers: [
              {
                providerId: 'deepseek',
                models: [
                  {
                    id: 'example-global',
                    label: 'Example',
                    priceTier: 'low',
                    capabilities: ['text'],
                    iconUrl: 'https://www.ncurator.com/llm/deepseek.png'
                  }
                ]
              }
            ]
          })
        : new Response(null, { status: 404 })
    )
    vi.stubGlobal('fetch', request)
    try {
      const { PresetModelCatalogService: OverseasCatalog } =
        await import('../../../../src/main/services/llm/PresetModelCatalogService')
      const snapshot = await new OverseasCatalog().refresh()
      expect(snapshot.providers[0].models[0].id).toBe('example-global')
      expect(request.mock.calls[0][0]).toBe(catalogPath)
      expect(request.mock.calls.every(([url]) => !String(url).includes('guanzhangai.cn'))).toBe(
        true
      )
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
      await fs.rm(folder, { recursive: true, force: true })
    }
  })
})

it('restores a saved free selection but sends only the current numeric execution ID', async () => {
  vi.resetModules()
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-free-catalog-v3-'))
  vi.stubEnv('NCURATOR_USER_DATA_PATH', folder)
  vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'test-domestic-catalog-app-key')
  const legacy = sampleEntry()
  const credential = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5400 })).toString('base64url')}.signature`
  const executionId = '9007199254740993'
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/api/v1/model-catalog'))
      return Response.json({
        protocolVersion: 1,
        revision: 'a'.repeat(64),
        models: [
          {
            id: executionId,
            kind: 'free',
            label: legacy.label,
            capabilities: ['text'],
            contextWindowTokens: 4096,
            iconUrl: legacy.iconUrl,
            legacy: { id: legacy.id, modelName: legacy.modelName }
          }
        ]
      })
    if (String(url).endsWith('/api/v1/free/token')) return Response.json({ token: credential })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const { FreeModelCatalogService: DomesticFreeCatalog } =
      await import('../../../../src/main/services/llm/FreeModelCatalogService')
    const service = new DomesticFreeCatalog()
    const snapshot = await service.refresh()
    const catalogRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/model-catalog')
    )
    expect(new Headers(catalogRequest?.[1]?.headers).get('authorization')).toBeNull()
    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.models[0]).toMatchObject({
      id: legacy.id,
      configId: toFreeModelConfigId(legacy.id),
      modelName: legacy.modelName
    })
    expect(snapshot.models[0]).not.toHaveProperty('executionId')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/free/token'))).toBe(false)

    const reloaded = new DomesticFreeCatalog()
    expect((await reloaded.getSnapshot()).models).toEqual(snapshot.models)
    expect(
      await reloaded.resolveRuntimeConfig(toFreeModelConfigId(legacy.id), 'other-model')
    ).toBeNull()
    expect(
      await reloaded.resolveRuntimeConfig(toFreeModelConfigId(legacy.id), legacy.modelName)
    ).toMatchObject({
      model_name: executionId,
      base_url: 'https://www.guanzhangai.cn/api/v2/free',
      api_key: credential
    })
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/free/token'))
    ).toHaveLength(1)
    const persisted = await fs.readFile(
      path.join(folder, 'domestic-zh-CN-free-models-catalog.json'),
      'utf8'
    )
    expect(persisted).not.toContain(credential)
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await fs.rm(folder, { recursive: true, force: true })
  }
})
