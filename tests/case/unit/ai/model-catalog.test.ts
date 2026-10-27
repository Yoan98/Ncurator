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
      error: `HTTP 401 Unauthorized\n\n${body.replace(config.api_key, '[REDACTED]')}`
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
      error: `HTTP 404 Not Found\n\n${body}`
    })
  })

  it('reports an invalid JSON success response instead of an empty model list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream unavailable')))

    const result = await fetchLlmRemoteModels(config)
    expect(result.success).toBe(false)
    expect(result.error).toContain('响应不是有效的 JSON')
    expect(result.error).toContain('upstream unavailable')
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

    expect(await fetchLlmRemoteModels(config)).toEqual({
      success: false,
      items: [],
      error: 'fetch failed\nconnect ECONNREFUSED 127.0.0.1:1234'
    })
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
    expect(await pending).toEqual({ success: false, items: [], error: '请求超时（20 秒）' })
  })
})
