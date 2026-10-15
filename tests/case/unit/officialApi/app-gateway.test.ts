import { createHmac, createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_CLIENT_HEADER,
  APP_NONCE_HEADER,
  APP_SIGNATURE_HEADER,
  APP_TIMESTAMP_HEADER,
  buildAppGatewaySignaturePayload,
  buildDesktopAppGatewayHeaders,
  createFreeModelFetch
} from '../../../../src/main/services/officialApi/appClient'
import { readJwtExpiryMs } from '../../../../src/main/services/officialApi/freeModelToken'

const originalSecret = process.env.NCURATOR_APP_SECRET_DESKTOP

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalSecret === undefined) delete process.env.NCURATOR_APP_SECRET_DESKTOP
  else process.env.NCURATOR_APP_SECRET_DESKTOP = originalSecret
})

const jwt = (name: string): string =>
  `${name}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 5400 })).toString('base64url')}.signature`

describe('all free models use the official proxy', () => {
  it.each(['glm-4.7-flash', 'glm-4-flash-250414', 'grok-4.5', 'Qwen/Qwen3.8-Flash-Next'])(
    'signs %s requests with a temporary credential',
    async (model) => {
      vi.resetModules()
      process.env.NCURATOR_APP_SECRET_DESKTOP = 'unit-test-secret'
      const { seedFreeModelToken } =
        await import('../../../../src/main/services/officialApi/freeModelToken')
      const credential = jwt('seed')
      seedFreeModelToken(credential)
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: '你好' }],
        stream: true
      })
      const response = await createFreeModelFetch()(
        'https://www.guanzhangai.cn/api/v1/free/chat/completions',
        { method: 'POST', body }
      )
      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const init = fetchMock.mock.calls[0][1]
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe(`Bearer ${credential}`)
      expect(headers.get(APP_SIGNATURE_HEADER)).toMatch(/^[0-9a-f]{64}$/)
      expect(init?.body).toBe(body)
    }
  )

  it('refreshes on proxy 401 once and signs the retry with a fresh nonce', async () => {
    vi.resetModules()
    process.env.NCURATOR_APP_SECRET_DESKTOP = 'unit-test-secret'
    const { seedFreeModelToken } =
      await import('../../../../src/main/services/officialApi/freeModelToken')
    seedFreeModelToken(jwt('seed'))
    const refreshed = jwt('refreshed')
    const requests: Array<{ url: string; headers: Headers; body: BodyInit | null | undefined }> = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers), body: init?.body })
      if (String(input).endsWith('/free/token')) return Response.json({ token: refreshed })
      return requests.length === 1
        ? new Response('', { status: 401 })
        : Response.json({ choices: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify({ model: 'grok-4.5', messages: [], stream: true })
    expect(
      (
        await createFreeModelFetch()('https://www.guanzhangai.cn/api/v1/free/chat/completions', {
          method: 'POST',
          body
        })
      ).status
    ).toBe(200)
    expect(requests).toHaveLength(3)
    expect(requests[1].url).toBe('https://www.guanzhangai.cn/api/v1/free/token')
    expect(requests[2].headers.get('Authorization')).toBe(`Bearer ${refreshed}`)
    expect(requests[2].headers.get(APP_NONCE_HEADER)).not.toBe(
      requests[0].headers.get(APP_NONCE_HEADER)
    )
    expect(requests[2].body).toBe(body)
  })

  it('does not renew JWTs for provider failures or send credentials to other hosts', async () => {
    vi.resetModules()
    const { seedFreeModelToken } =
      await import('../../../../src/main/services/officialApi/freeModelToken')
    seedFreeModelToken(jwt('seed'))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('upstream failed', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const send = createFreeModelFetch()
    expect((await send('https://www.guanzhangai.cn/api/v1/free/chat/completions')).status).toBe(502)
    await expect(send('https://example.com/api/v1/free/chat/completions')).rejects.toThrow(
      '免费模型调用地址无效'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('desktop app gateway headers', () => {
  it('omits HMAC headers when the desktop secret is missing', () => {
    delete process.env.NCURATOR_APP_SECRET_DESKTOP
    expect(
      buildDesktopAppGatewayHeaders({
        method: 'GET',
        url: 'https://www.guanzhangai.cn/api/v1/free-models'
      })
    ).toEqual({})
  })

  it('signs method, path, timestamp, nonce and body hash', () => {
    process.env.NCURATOR_APP_SECRET_DESKTOP = 'unit-test-secret'
    const headers = buildDesktopAppGatewayHeaders({
      method: 'POST',
      url: 'https://www.guanzhangai.cn/api/v1/free/token',
      body: ''
    })
    expect(headers[APP_CLIENT_HEADER]).toBe('desktop')
    expect(headers[APP_TIMESTAMP_HEADER]).toMatch(/^\d+$/)
    expect(headers[APP_NONCE_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    const payload = buildAppGatewaySignaturePayload({
      method: 'POST',
      path: '/api/v1/free/token',
      timestamp: headers[APP_TIMESTAMP_HEADER],
      nonce: headers[APP_NONCE_HEADER],
      body: ''
    })
    const expected = createHmac('sha256', 'unit-test-secret').update(payload, 'utf8').digest('hex')
    expect(headers[APP_SIGNATURE_HEADER]).toBe(expected)
    expect(payload.split('\n')[4]).toBe(createHash('sha256').update('', 'utf8').digest('hex'))
  })
})

describe('free model token expiry', () => {
  it('reads exp from an unsigned JWT payload', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    expect(readJwtExpiryMs(`aaa.${payload}.bbb`)).toBe(1_800_000_000 * 1000)
  })
})
