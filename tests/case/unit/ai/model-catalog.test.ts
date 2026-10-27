import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLlmRemoteModels } from '../../../../src/main/services/llm/modelCatalog'

const config = {
  id: 'cfg-1',
  name: 'Provider',
  providerKind: 'openai-compatible' as const,
  base_url: 'https://example.test/v1',
  api_key: 'test-secret-key'
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('llm model catalog', () => {
  it('filters unavailable models and preserves modalities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'shutdown-model',
                status: 'Shutdown'
              },
              {
                id: 'prompt-json-model',
                status: 'Running',
                features: {
                  structured_outputs: {
                    json_schema: false,
                    json_object: false
                  }
                },
                modalities: {
                  input_modalities: ['text', 'image'],
                  output_modalities: ['text']
                }
              }
            ]
          })
      })
    )

    const result = await fetchLlmRemoteModels({
      id: 'cfg-1',
      name: 'Provider',
      providerKind: 'openai-compatible',
      base_url: 'https://example.test/v1',
      api_key: 'test-key'
    })

    expect(result).toEqual({
      success: true,
      items: [
        {
          id: 'prompt-json-model',
          label: 'prompt-json-model',
          status: 'Running',
          inputModalities: ['text', 'image'],
          outputModalities: ['text']
        }
      ]
    })
  })

  it('preserves the HTTP status and response body while redacting the configured key', async () => {
    const body = JSON.stringify({ error: { message: `Invalid API key: ${config.api_key}` } })
    const fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 401,
        statusText: 'Unauthorized'
      })
    )
    vi.stubGlobal('fetch', fetch)

    const result = await fetchLlmRemoteModels(config)

    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${config.api_key}` })
      })
    )
    expect(result).toEqual({
      success: false,
      items: [],
      error: `GET https://example.test/v1/models\n\nHTTP 401 Unauthorized\n\n${body.replace(config.api_key, '[REDACTED]')}`
    })
    expect(result.error).not.toContain(config.api_key)
  })

  it('keeps a non-JSON HTTP error body available for diagnosis', async () => {
    const body = '<html><body>Gateway route not found</body></html>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 404,
          statusText: 'Not Found'
        })
      )
    )

    expect(await fetchLlmRemoteModels(config)).toEqual({
      success: false,
      items: [],
      error: `GET https://example.test/v1/models\n\nHTTP 404 Not Found\n\n${body}`
    })
  })

  it('reports an invalid JSON success response instead of an empty model list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream unavailable')))

    const result = await fetchLlmRemoteModels(config)
    expect(result.success).toBe(false)
    expect(result.error).toContain('响应不是有效的 JSON')
    expect(result.error).toContain('upstream unavailable')
    expect(result.error).toContain('SyntaxError')
  })

  it.each([null, { models: ['chat-model'] }, { error: { message: 'Access denied' } }])(
    'reports an unexpected response structure: %j',
    async (payload) => {
      const body = JSON.stringify(payload)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))

      const result = await fetchLlmRemoteModels(config)
      expect(result.success).toBe(false)
      expect(result.error).toContain('缺少 data 数组')
      expect(result.error).toContain(body)
    }
  )

  it('keeps a successful empty list distinct from a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"data":[]}')))

    expect(await fetchLlmRemoteModels(config)).toEqual({ success: true, items: [] })
  })

  it('preserves the underlying connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        new Error('fetch failed', {
          cause: new Error('connect ECONNREFUSED 127.0.0.1:1234')
        })
      )
    )

    const result = await fetchLlmRemoteModels(config)
    expect(result.success).toBe(false)
    expect(result.error).toContain('GET https://example.test/v1/models')
    expect(result.error).toContain('未收到 HTTP 响应')
    expect(result.error).toContain('Error: fetch failed')
    expect(result.error).toContain('connect ECONNREFUSED 127.0.0.1:1234')
  })

  it('preserves the socket error code, stack and deeper cause instead of only two messages', async () => {
    class SocketError extends Error {
      override name = 'SocketError'
    }
    const inner = Object.assign(new Error(`connection detail ${config.api_key}`), {
      code: 'ECONNRESET',
      syscall: 'read'
    })
    const socket = Object.assign(new SocketError('other side closed', { cause: inner }), {
      name: 'SocketError',
      code: 'UND_ERR_SOCKET',
      socket: { remoteAddress: '127.0.0.1', remotePort: 9000, bytesRead: 0 }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: socket }))
    )
    const result = await fetchLlmRemoteModels(config)
    for (const detail of [
      'TypeError: fetch failed',
      'SocketError: other side closed',
      'UND_ERR_SOCKET',
      'ECONNRESET',
      'read',
      'remoteAddress',
      '127.0.0.1',
      'remotePort',
      '9000',
      'bytesRead',
      'connection detail [REDACTED]',
      'model-catalog.test.ts'
    ]) {
      expect(result.error).toContain(detail)
    }
    expect(result.error).not.toContain(config.api_key)
    expect(result.error).not.toMatch(/HTTP \d{3}/u)
  })

  it('keeps all underlying errors of an aggregate connection failure', async () => {
    const cause = new AggregateError(
      [
        Object.assign(new Error('connect ::1'), { code: 'ECONNREFUSED', address: '::1' }),
        Object.assign(new Error('connect 127.0.0.1'), {
          code: 'ECONNREFUSED',
          address: '127.0.0.1'
        })
      ],
      'All addresses failed'
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })))
    const result = await fetchLlmRemoteModels(config)
    expect(result.error).toContain('AggregateError: All addresses failed')
    expect(result.error).toContain('connect ::1')
    expect(result.error).toContain('connect 127.0.0.1')
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('keeps non-Error causes and redacts keys in nested diagnostic fields and the URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        new TypeError('fetch failed', {
          cause: {
            code: 'ENOTFOUND',
            hostname: 'invalid.test',
            authorization: `Bearer ${config.api_key}`
          }
        })
      )
    )
    const result = await fetchLlmRemoteModels({
      ...config,
      base_url: `${config.base_url}/${config.api_key}`
    })
    expect(result.error).toContain('ENOTFOUND')
    expect(result.error).toContain('invalid.test')
    expect(result.error).toContain('Bearer [REDACTED]')
    expect(result.error).not.toContain(config.api_key)
  })

  it('keeps an HTTP status already received when reading the response body fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        text: async () => {
          throw new TypeError('terminated', {
            cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
          })
        }
      })
    )
    const result = await fetchLlmRemoteModels(config)
    expect(result.error).toContain('HTTP 401 Unauthorized')
    expect(result.error).toContain('TypeError: terminated')
    expect(result.error).toContain('UND_ERR_SOCKET')
    expect(result.error).not.toContain('未收到 HTTP 响应')
  })

  it('reports a timeout when the request is aborted by its deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          )
      )
    )

    const pending = fetchLlmRemoteModels(config)
    await vi.advanceTimersByTimeAsync(20_000)
    const result = await pending
    expect(result.success).toBe(false)
    expect(result.items).toEqual([])
    expect(result.error).toContain('请求超时（20 秒）')
    expect(result.error).toContain('未收到 HTTP 响应')
    expect(result.error).toContain('Error: aborted')
  })
})
