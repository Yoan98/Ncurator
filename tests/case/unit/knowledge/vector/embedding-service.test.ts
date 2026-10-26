import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EmbeddingService,
  type EmbeddingExecutor
} from '../../../../../src/main/services/vector/EmbeddingService'
import {
  EmbeddingModelService,
  remoteEmbeddingIdentity
} from '../../../../../src/main/services/vector/EmbeddingModelService'
import { RemoteEmbeddingExecutor } from '../../../../../src/main/services/vector/runtime/RemoteEmbeddingExecutor'
import {
  assertEmbeddingInputBudget,
  estimateEmbeddingTokens,
  splitEmbeddingText
} from '../../../../../src/main/services/vector/runtime/embeddingInputBudget'
import {
  defaultEmbeddingInputTokens,
  embeddingInputBudget,
  LOCAL_EMBEDDING_MODEL_ID,
  type EmbeddingModelSettings,
  type RemoteEmbeddingModel
} from '../../../../../src/shared/embeddingModels'

vi.mock('../../../../../src/main/services/model/ModelService', () => ({
  ModelService: {
    getInstance: vi.fn(() => {
      throw new Error('Unexpected local model access')
    })
  }
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const result = {
  data: new Float32Array([1, 2]),
  dims: [1, 2] as [number, number]
}

describe('EmbeddingService', () => {
  it('cancels a pending runtime initialization before waiting for shutdown', async () => {
    let rejectInitialization!: (error: Error) => void
    const executor: EmbeddingExecutor = {
      initialize: () =>
        new Promise<void>((_resolve, reject) => {
          rejectInitialization = reject
        }),
      embed: async () => result,
      cancelPending: vi.fn(async () => {
        rejectInitialization(new Error('runtime cancelled'))
      }),
      close: vi.fn(async () => undefined)
    }
    const service = new EmbeddingService({ executor })
    const loading = expect(service.initialize()).rejects.toThrow('向量模型初始化失败')
    await service.close()
    await loading
    expect(executor.cancelPending).toHaveBeenCalledTimes(1)
    expect(executor.close).toHaveBeenCalledTimes(1)
    expect(service.getStatus()).toBe('uninitialized')
  })

  it('waits for an in-flight initialization before embedding', async () => {
    let finishInitialization!: () => void
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(
        async () =>
          await new Promise<void>((resolve) => {
            finishInitialization = resolve
          })
      ),
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })

    const initialization = service.initialize()
    const embedding = service.embed('text')
    expect(executor.embed).not.toHaveBeenCalled()

    finishInitialization()
    await initialization
    await expect(embedding).resolves.toEqual({ ...result, modelIdentity: LOCAL_EMBEDDING_MODEL_ID })
    expect(executor.initialize).toHaveBeenCalledTimes(1)
  })

  it('wraps initialization failures with a user-facing message and preserves the cause', async () => {
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(async () => {
        throw new Error('model unavailable')
      }),
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })

    await expect(service.initialize()).rejects.toMatchObject({
      message: expect.stringContaining('向量模型初始化失败'),
      cause: expect.objectContaining({ message: 'model unavailable' })
    })
    expect(service.getStatus()).toBe('error')
  })

  it('exposes the live embedding runtime pid and intraOp from the executor', () => {
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(async () => undefined),
      embed: vi.fn(async () => result),
      getRuntimeProcessInfo: () => ({
        pid: 4242,
        intraOpNumThreads: 7
      })
    }
    const service = new EmbeddingService({ executor })
    expect(service.getRuntimeSnapshot()).toEqual({
      status: 'uninitialized',
      pid: 4242,
      intraOpNumThreads: 7
    })
  })

  it('retries initialization after a failure', async () => {
    const initialize = vi
      .fn<EmbeddingExecutor['initialize']>()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined)
    const executor: EmbeddingExecutor = {
      initialize,
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })

    await expect(service.embed('first')).rejects.toThrow('向量模型初始化失败')
    await expect(service.embed('second')).resolves.toEqual({
      ...result,
      modelIdentity: LOCAL_EMBEDDING_MODEL_ID
    })
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})

it('waits for initialization before closing and clears the ready cache', async () => {
  let finish!: () => void
  const executor: EmbeddingExecutor = {
    initialize: () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    embed: async () => result,
    close: vi.fn(async () => undefined)
  }
  const service = new EmbeddingService({ executor })
  const loading = service.initialize()
  const closing = service.close()
  expect(executor.close).not.toHaveBeenCalled()
  finish()
  await loading
  await closing
  expect(executor.close).toHaveBeenCalledTimes(1)
  expect(service.getStatus()).toBe('uninitialized')
})

it('resets a runtime for later model loading without permanently closing it', async () => {
  let closed = false
  const executor: EmbeddingExecutor = {
    initialize: async () => {
      if (closed) throw new Error('embedding runtime client is closed')
    },
    embed: async () => result,
    close: async () => {
      closed = true
    },
    restart: async () => {
      closed = false
    }
  }
  const service = new EmbeddingService({ executor })
  await service.initialize()
  await service.reset()
  expect(service.getStatus()).toBe('uninitialized')
  await expect(service.embed('after reinstall')).resolves.toEqual({
    ...result,
    modelIdentity: LOCAL_EMBEDDING_MODEL_ID
  })
  await service.close()
  await expect(service.initialize()).rejects.toThrow('向量模型初始化失败')
})

const remoteModel: RemoteEmbeddingModel = {
  id: 'remote:unit-test',
  name: 'Unit embedding',
  baseUrl: 'https://embedding.example.invalid/v1',
  modelName: 'unit-embedding',
  apiKey: 'unit-test-key-not-a-credential'
}

const embeddingResponse = (embedding = [1, 2]): Response =>
  Response.json({ data: [{ index: 0, embedding }] })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('RemoteEmbeddingExecutor unit transport contracts', () => {
  it.each([
    ['https://embedding.example.invalid', 'https://embedding.example.invalid/v1/embeddings'],
    ['https://embedding.example.invalid/v1/', 'https://embedding.example.invalid/v1/embeddings'],
    [
      'https://embedding.example.invalid/v1/embeddings',
      'https://embedding.example.invalid/v1/embeddings'
    ],
    [
      'https://embedding.example.invalid/proxy/v2/',
      'https://embedding.example.invalid/proxy/v2/embeddings'
    ]
  ])(
    'posts to the normalized endpoint for %s and restores response order',
    async (baseUrl, url) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          data: [
            { index: 1, embedding: [3, 4] },
            { index: 0, embedding: [1, 2] }
          ]
        })
      )
      const executor = new RemoteEmbeddingExecutor({ ...remoteModel, baseUrl, fetch })
      await expect(executor.embed(['first', 'second'])).resolves.toEqual({
        data: new Float32Array([1, 2, 3, 4]),
        dims: [2, 2]
      })
      expect(fetch).toHaveBeenCalledTimes(1)
      const [actualUrl, request] = fetch.mock.calls[0]
      expect(actualUrl).toBe(url)
      expect(request).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal) })
      const headers = new Headers(request?.headers)
      expect(headers.get('Authorization')).toBe(`Bearer ${remoteModel.apiKey}`)
      expect(headers.get('Content-Type')).toBe('application/json')
      expect(JSON.parse(String(request?.body))).toMatchObject({
        model: remoteModel.modelName,
        input: ['first', 'second'],
        encoding_format: 'float'
      })
    }
  )

  it.each([429, 500])('retries HTTP %i and recovers within the attempt budget', async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(embeddingResponse())
    const executor = new RemoteEmbeddingExecutor({
      ...remoteModel,
      fetch,
      maxAttempts: 3,
      retryDelayMs: 0
    })
    await expect(executor.embed(['text'])).resolves.toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1]?.body).toBe(fetch.mock.calls[1][1]?.body)
  })

  it.each([429, 500])('stops retrying HTTP %i after the finite attempt budget', async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('', { status }))
    const executor = new RemoteEmbeddingExecutor({
      ...remoteModel,
      fetch,
      maxAttempts: 3,
      retryDelayMs: 0
    })
    await expect(executor.embed(['text'])).rejects.toThrow(`HTTP ${status}`)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry HTTP 401 or expose the provider response containing a key', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(remoteModel.apiKey, { status: 401 }))
    const executor = new RemoteEmbeddingExecutor({
      ...remoteModel,
      fetch,
      maxAttempts: 3,
      retryDelayMs: 0
    })
    const failure = executor.embed(['text'])
    await expect(failure).rejects.toThrow('HTTP 401')
    await expect(failure).rejects.not.toThrow(remoteModel.apiKey)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports the structured HTTP 400 cause without retrying or changing the request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: { message: 'Model unit-embedding does not support this input length' },
          message: 'less specific error',
          debug: 'unlisted provider diagnostics'
        },
        { status: 400 }
      )
    )
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, retryDelayMs: 0 })
    await expect(executor.embed(['original input'])).rejects.toThrow(
      'HTTP 400: Model unit-embedding does not support this input length'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      model: remoteModel.modelName,
      input: ['original input'],
      encoding_format: 'float'
    })
  })

  it.each([
    { message: 'Invalid model parameter' },
    { detail: 'Invalid model parameter' },
    { error: 'Invalid model parameter' }
  ])('reports a top-level structured error: %j', async (body) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(body, { status: 400 }))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, retryDelayMs: 0 })
    await expect(executor.embed(['source'])).rejects.toThrow('HTTP 400: Invalid model parameter')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([400, 401])(
    'redacts keys, common credentials and echoed input from HTTP %i',
    async (status) => {
      const apiKey = 'unit-"key\\with/slash+equals=秘'
      const texts = ['private "document"\nwith/slash+equals=秘密', 'another confidential input']
      const sensitive = [apiKey, ...texts]
      const variants = sensitive.flatMap((value) => [
        value,
        JSON.stringify(value).slice(1, -1),
        encodeURIComponent(value),
        encodeURIComponent(value).replace(/%[\dA-F]{2}/gu, (match) => match.toLowerCase())
      ])
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              message: [
                'Invalid input\n',
                ...variants,
                'Authorization: Bearer other-auth-credential',
                'Bearer other-bearer-credential',
                'Proxy-Authorization: Basic other-basic-credential',
                'api_key="other-api-credential"',
                'access_token=other-token-credential',
                'password: other-password-credential',
                'x-api-key: other-header-credential'
              ].join('; ')
            },
            debug: 'unlisted-secret-diagnostics'
          },
          { status }
        )
      )
      const executor = new RemoteEmbeddingExecutor({
        ...remoteModel,
        apiKey,
        fetch,
        retryDelayMs: 0
      })
      const failure = await executor.embed(texts).catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      const message = (failure as Error).message
      expect(message).toContain(`HTTP ${status}: Invalid input`)
      for (const value of [
        ...variants,
        'confidential',
        'document',
        '秘密',
        'other-',
        'unlisted-secret'
      ]) {
        expect(message).not.toContain(value)
      }
      expect(message).not.toMatch(/[\r\n]/u)
      expect(message.length).toBeLessThanOrEqual(600)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('limits structured diagnostics to a single bounded line', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: { message: `Invalid input\r\n${'reason '.repeat(200)}\u2028trailing detail` }
        },
        { status: 400 }
      )
    )
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch })
    const failure = await executor.embed(['source']).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('HTTP 400: Invalid input reason')
    expect((failure as Error).message).not.toMatch(/[\r\n\u2028\u2029]/u)
    expect((failure as Error).message.length).toBeLessThanOrEqual(600)
  })

  it.each([
    ['HTML', '<html><body>private diagnostic</body></html>'],
    ['malformed JSON', '{"message":"private diagnostic"'],
    ['empty body', ''],
    ['JSON string', '"private diagnostic"'],
    ['unlisted field', '{"debug":"private diagnostic"}'],
    ['non-string field', '{"message":{"value":"private diagnostic"}}'],
    ['oversized ASCII body', JSON.stringify({ message: `private diagnostic ${'x'.repeat(8192)}` })],
    ['oversized UTF-8 body', JSON.stringify({ message: `private diagnostic ${'汉'.repeat(3000)}` })]
  ])('keeps only the HTTP status for %s', async (_label, body) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 400 }))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, retryDelayMs: 0 })
    await expect(executor.embed(['source'])).rejects.toThrow(
      /^Remote embedding request failed: HTTP 400$/u
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the HTTP status when reading the error body fails', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('untrusted body read failure'))
      }
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 400 }))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, retryDelayMs: 0 })
    await expect(executor.embed(['source'])).rejects.toThrow(
      /^Remote embedding request failed: HTTP 400$/u
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps HTTP 400 and cancels a stalled body after the independent read deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":{"message":"partial'))
      },
      cancel
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 400 }))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, timeoutMs: 30_000 })
    const failure = expect(executor.embed(['source'])).rejects.toThrow(
      /^Remote embedding request failed: HTTP 400$/u
    )
    await vi.advanceTimersByTimeAsync(999)
    expect(cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await failure
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('close promptly aborts a pending error body without waiting for cancellation', async () => {
    vi.useFakeTimers()
    const started = deferred<void>()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const body = new ReadableStream<Uint8Array>({
      pull() {
        started.resolve()
      },
      cancel
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 400 }))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch })
    const failure = expect(executor.embed(['source'])).rejects.toThrow(/closed/i)
    await started.promise
    await executor.close()
    await failure
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves HTTP 400 when the overall request expires during error body reading', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { status: 400 }))
    const executor = new RemoteEmbeddingExecutor({
      ...remoteModel,
      fetch,
      timeoutMs: 25,
      retryDelayMs: 0
    })
    const failure = expect(executor.embed(['source'])).rejects.toThrow(
      /^Remote embedding request failed: HTTP 400$/u
    )
    await vi.advanceTimersByTimeAsync(25)
    await failure
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['fetch', 'body'] as const)(
    'times out a stalled %s even if the transport ignores abort',
    async (stage) => {
      vi.useFakeTimers()
      const stalled = deferred<Response>()
      const response = {
        ok: true,
        status: 200,
        json: vi.fn(() => new Promise(() => {})),
        text: vi.fn(() => new Promise(() => {}))
      } as Response
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(() => (stage === 'fetch' ? stalled.promise : Promise.resolve(response)))
      const executor = new RemoteEmbeddingExecutor({
        ...remoteModel,
        fetch,
        timeoutMs: 25,
        maxAttempts: 2,
        retryDelayMs: 0
      })
      const outcome = executor.embed(['text']).then(
        (value) => ({ value, error: null }),
        (error: Error) => ({ value: null, error })
      )
      await vi.advanceTimersByTimeAsync(50)
      expect((await outcome).error?.message).toMatch(/timed out|timeout/i)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(fetch.mock.calls.every(([, request]) => request?.signal?.aborted)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('rejects dimension drift and retains the previously accepted dimension', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(embeddingResponse())
      .mockResolvedValueOnce(embeddingResponse([1, 2, 3]))
      .mockResolvedValueOnce(embeddingResponse([3, 4]))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch })
    await expect(executor.embed(['first'])).resolves.toEqual(result)
    await expect(executor.embed(['drift'])).rejects.toThrow(/dimension/i)
    await expect(executor.embed(['recovery'])).resolves.toMatchObject({ dims: [1, 2] })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['empty vector', []],
    ['zero vector', [0, 0]],
    ['null component', [null, 1]],
    ['infinity', [Infinity, 1]],
    ['non-number', ['1', 2]],
    ['Float32 overflow', [1e40, 1]],
    ['Float32 underflow to zero', [1e-100, 0]]
  ])('rejects %s without retrying', async (_label, embedding) => {
    const components = (embedding as Array<number | string | null>).map((value) =>
      value === Infinity ? '1e400' : JSON.stringify(value)
    )
    const response = new Response(`{"data":[{"index":0,"embedding":[${components.join(',')}]}]}`, {
      headers: { 'Content-Type': 'application/json' }
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, retryDelayMs: 0 })
    await expect(executor.embed(['text'])).rejects.toThrow(/invalid|vector|embedding/i)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing item', [{ index: 0, embedding: [1, 2] }]],
    [
      'duplicate index',
      [
        { index: 0, embedding: [1, 2] },
        { index: 0, embedding: [3, 4] }
      ]
    ],
    [
      'out-of-range index',
      [
        { index: 0, embedding: [1, 2] },
        { index: 2, embedding: [3, 4] }
      ]
    ],
    [
      'inconsistent dimensions',
      [
        { index: 0, embedding: [1, 2] },
        { index: 1, embedding: [3] }
      ]
    ]
  ])('rejects response with %s', async (_label, data) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data }))
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, fetch, retryDelayMs: 0 })
    await expect(executor.embed(['one', 'two'])).rejects.toThrow(/invalid|dimension|index/i)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('EmbeddingService configuration isolation', () => {
  it.each(['resolve', 'reject'] as const)(
    'rejects an old in-flight embedding when it later %ss',
    async (outcome) => {
      const pending = deferred<typeof result>()
      const started = deferred<void>()
      const previous: EmbeddingExecutor = {
        initialize: async () => undefined,
        embed: vi.fn(() => {
          started.resolve()
          return pending.promise
        })
      }
      const next: EmbeddingExecutor = {
        initialize: vi.fn(async () => undefined),
        embed: vi.fn(async () => result)
      }
      const service = new EmbeddingService({ executor: previous })
      const oldEmbedding = service.embed('old')
      const rejected = expect(oldEmbedding).rejects.toThrow(/configuration changed/i)
      await started.promise
      await service.configure({
        executor: next,
        modelName: 'new-model',
        identity: 'remote:new',
        kind: 'remote'
      })
      await expect(service.embed('new')).resolves.toEqual({
        ...result,
        modelIdentity: 'remote:new'
      })
      if (outcome === 'resolve') pending.resolve(result)
      else pending.reject(new Error('old transport failed'))
      await rejected
      expect(service.getStatus()).toBe('ready')
      expect(service.getIndexIdentity()).toBe('remote:new')
    }
  )

  it.each(['resolve', 'reject'] as const)(
    'preserves the new initialization when old initialization %ss',
    async (outcome) => {
      const oldReady = deferred<void>()
      const newReady = deferred<void>()
      const previous: EmbeddingExecutor = {
        initialize: () => oldReady.promise,
        embed: vi.fn(async () => result)
      }
      const next: EmbeddingExecutor = {
        initialize: vi.fn(() => newReady.promise),
        embed: vi.fn(async () => result)
      }
      const service = new EmbeddingService({ executor: previous })
      const oldEmbedding = service.embed('old')
      const rejected = expect(oldEmbedding).rejects.toThrow(/configuration changed/i)
      await service.configure({
        executor: next,
        modelName: 'new-model',
        identity: 'remote:new',
        kind: 'remote'
      })
      const first = service.embed('new first')
      if (outcome === 'resolve') oldReady.resolve()
      else oldReady.reject(new Error('old initialization failed'))
      await rejected
      expect(service.getStatus()).toBe('initializing')
      const second = service.embed('new second')
      expect(next.initialize).toHaveBeenCalledTimes(1)
      expect(next.embed).not.toHaveBeenCalled()
      expect(previous.embed).not.toHaveBeenCalled()
      newReady.resolve()
      await expect(first).resolves.toEqual({ ...result, modelIdentity: 'remote:new' })
      await expect(second).resolves.toEqual({ ...result, modelIdentity: 'remote:new' })
      expect(service.getStatus()).toBe('ready')
    }
  )
})

function createModelFixture(model: RemoteEmbeddingModel = remoteModel) {
  let settings: EmbeddingModelSettings = {
    activeModelId: model.id,
    remoteModels: [{ ...model }]
  }
  const settingsStore = {
    get: vi.fn(() => structuredClone(settings)),
    save: vi.fn((value: EmbeddingModelSettings) => {
      settings = structuredClone(value)
    })
  }
  const documentsStore = {
    getEmbeddingIndexState: vi.fn((identity: string) => ({
      staleFileCount: 0,
      staleWebCount: 0,
      completeIdentity: identity
    }))
  }
  const indexJobStore = { hasRunningPrepareJob: vi.fn(async () => false) }
  const local: EmbeddingExecutor = {
    initialize: vi.fn(async () => undefined),
    embed: vi.fn(async () => result)
  }
  const embeddingService = new EmbeddingService({ executor: local })
  type Dependencies = ConstructorParameters<typeof EmbeddingModelService>[0]
  const service = new EmbeddingModelService({
    indexJobStore,
    settingsStore: settingsStore as Dependencies['settingsStore'],
    documentsStore: documentsStore as Dependencies['documentsStore'],
    embeddingService,
    createLocalExecutor: () => local
  })
  return { service, settingsStore, documentsStore, embeddingService, indexJobStore, local }
}

describe('EmbeddingModelService unit configuration contracts', () => {
  it('never starts embeddings on initialization, model selection or reopening', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    vi.useFakeTimers()
    try {
      for (let restart = 0; restart < 2; restart += 1) {
        const { service, local, documentsStore } = createModelFixture()
        documentsStore.getEmbeddingIndexState.mockReturnValue({
          staleFileCount: 1,
          staleWebCount: 1,
          completeIdentity: LOCAL_EMBEDDING_MODEL_ID
        })
        try {
          await service.initialize()
          expect((await service.getSnapshot()).index).toMatchObject({
            staleFileCount: 1,
            staleWebCount: 1,
            restoreModelId: LOCAL_EMBEDDING_MODEL_ID
          })
          await service.select(LOCAL_EMBEDDING_MODEL_ID)
          await service.select(remoteModel.id)
          await vi.advanceTimersByTimeAsync(60_000)
          expect(local.embed).not.toHaveBeenCalled()
          expect(fetch).not.toHaveBeenCalled()
        } finally {
          await service.close()
        }
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers restoration only for one complete configured model identity', async () => {
    const { service, documentsStore } = createModelFixture()
    try {
      await service.initialize()
      documentsStore.getEmbeddingIndexState.mockReturnValue({
        staleFileCount: 2,
        staleWebCount: 1,
        completeIdentity: LOCAL_EMBEDDING_MODEL_ID
      })
      expect((await service.getSnapshot()).index.restoreModelId).toBe(LOCAL_EMBEDDING_MODEL_ID)
      documentsStore.getEmbeddingIndexState.mockReturnValue({
        staleFileCount: 1,
        staleWebCount: 1,
        completeIdentity: undefined
      })
      expect((await service.getSnapshot()).index.restoreModelId).toBeUndefined()
      documentsStore.getEmbeddingIndexState.mockReturnValue({
        staleFileCount: 1,
        staleWebCount: 1,
        completeIdentity: 'remote:deleted-configuration'
      })
      expect((await service.getSnapshot()).index.restoreModelId).toBeUndefined()
    } finally {
      await service.close()
    }
  })

  it('rejects selection and active configuration changes while a manual index job is running', async () => {
    const { service, indexJobStore, embeddingService } = createModelFixture()
    try {
      await service.initialize()
      const identity = embeddingService.getIndexIdentity()
      indexJobStore.hasRunningPrepareJob.mockResolvedValue(true)
      await expect(service.select(LOCAL_EMBEDDING_MODEL_ID)).rejects.toThrow(
        'Indexing is in progress'
      )
      await expect(service.saveRemote({ ...remoteModel, modelName: 'different' })).rejects.toThrow(
        'Indexing is in progress'
      )
      expect((await service.getSnapshot()).activeModelId).toBe(remoteModel.id)
      expect(embeddingService.getIndexIdentity()).toBe(identity)
      indexJobStore.hasRunningPrepareJob.mockResolvedValue(false)
      await service.select(LOCAL_EMBEDDING_MODEL_ID)
      expect((await service.getSnapshot()).activeModelId).toBe(LOCAL_EMBEDDING_MODEL_ID)
    } finally {
      await service.close()
    }
  })

  it('omits API keys from read and mutation snapshots while retaining them in settings', async () => {
    const { service, settingsStore } = createModelFixture()
    try {
      const initial = await service.getSnapshot()
      const saved = await service.saveRemote({ ...remoteModel, apiKey: 'unit-test-rotated-key' })
      for (const snapshot of [initial, saved, await service.getSnapshot()]) {
        expect(snapshot.remoteModels[0]).toMatchObject({ id: remoteModel.id, hasApiKey: true })
        expect(snapshot.remoteModels[0]).not.toHaveProperty('apiKey')
        expect(JSON.stringify(snapshot)).not.toContain(remoteModel.apiKey)
        expect(JSON.stringify(snapshot)).not.toContain('unit-test-rotated-key')
      }
      expect(settingsStore.get().remoteModels[0].apiKey).toBe('unit-test-rotated-key')
    } finally {
      await service.close()
    }
  })

  it('rotates a key without changing vector identity or re-embedding completed documents', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => embeddingResponse())
    vi.stubGlobal('fetch', fetch)
    const { service, embeddingService } = createModelFixture()
    try {
      await service.initialize()
      const identity = embeddingService.getIndexIdentity()
      await service.saveRemote({ ...remoteModel, apiKey: 'unit-test-rotated-key' })
      await embeddingService.embed('explicit query after rotation')
      expect(embeddingService.getIndexIdentity()).toBe(identity)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe(
        'Bearer unit-test-rotated-key'
      )
    } finally {
      await service.close()
      await embeddingService.close()
    }
  })

  it('changes identity without starting indexing for a changed API address', async () => {
    const { service, embeddingService, documentsStore } = createModelFixture()
    try {
      await service.initialize()
      const previous = embeddingService.getIndexIdentity()
      const changed = { ...remoteModel, baseUrl: 'https://other.example.invalid/v1' }
      await service.saveRemote(changed)
      const next = embeddingService.getIndexIdentity()
      expect(next).not.toBe(previous)
      expect(next).toBe(remoteEmbeddingIdentity(changed))
      expect(documentsStore.getEmbeddingIndexState).toHaveBeenLastCalledWith(next)
    } finally {
      await service.close()
      await embeddingService.close()
    }
  })

  it('gives distinct identities to base URLs that send requests to different endpoints', async () => {
    const endpoints: string[] = []
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
      endpoints.push(String(url))
      return embeddingResponse()
    })
    const models = ['/gateway', '/gateway/v1'].map((path) => ({
      ...remoteModel,
      baseUrl: `https://embedding.example.invalid${path}`
    }))
    for (const model of models) {
      await new RemoteEmbeddingExecutor({ ...model, fetch }).embed(['text'])
    }
    expect(endpoints[0]).not.toBe(endpoints[1])
    expect(remoteEmbeddingIdentity(models[0])).not.toBe(remoteEmbeddingIdentity(models[1]))
  })

  it('retains an explicit root embeddings endpoint when saving and testing a configuration', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
    vi.stubGlobal('fetch', fetch)
    const { service, settingsStore } = createModelFixture()
    const changed = { ...remoteModel, baseUrl: 'https://embedding.example.invalid/embeddings' }
    try {
      await service.saveRemote(changed)
      expect(settingsStore.get().remoteModels[0].baseUrl).toBe(changed.baseUrl)
      await service.test(changed)
      expect(fetch.mock.calls[0][0]).toBe(changed.baseUrl)
      expect(remoteEmbeddingIdentity(changed)).not.toBe(
        remoteEmbeddingIdentity({ ...changed, baseUrl: 'https://embedding.example.invalid' })
      )
    } finally {
      await service.close()
    }
  })
})

describe('embedding input budget contracts', () => {
  it.each(['bge-large-zh-v1.5', 'BAAI/bge-m3', 'Qwen/Qwen3-Embedding-8B', 'unknown-model'])(
    'defaults %s to 512 without inferring its advertised context length',
    (modelName) => {
      expect(defaultEmbeddingInputTokens(modelName)).toBe(512)
    }
  )

  it.each([
    [32, 16, 16],
    [512, 16, 496],
    [8192, 205, 7987],
    [1_048_576, 26_215, 1_022_361]
  ])('reserves %i tokens as %i safety tokens and %i content tokens', (max, reserve, content) => {
    expect(embeddingInputBudget(max)).toEqual({
      reservedTokens: reserve,
      contentTokenBudget: content
    })
  })

  it.each([31, 1_048_577, 512.5, NaN, Infinity])('rejects an invalid total budget of %s', (max) => {
    expect(() => embeddingInputBudget(max)).toThrow(/32.*1048576/u)
  })

  it.each([
    ['', 0],
    ['ASCII', 5],
    ['中文', 6],
    ['é', 3],
    ['e\u0301', 3],
    ['İ', 3],
    ['Ａ', 3],
    ['㏍', 3],
    ['ﷺ', 33],
    ['👩‍💻', 11],
    ['éＡ㏍ﷺ👩‍💻', 53]
  ])('conservatively estimates %j as %i tokens per original code point', (text, tokens) => {
    expect(estimateEmbeddingTokens(text)).toBe(tokens)
  })

  it.each([
    ['ASCII paragraphs', 'A short sentence. Another sentence!\n\n'.repeat(50), 512],
    ['Chinese punctuation', '中文句子。另一段文字！\n'.repeat(60), 512],
    ['NFKD expansion', 'éİﷺＡ㏍'.repeat(60), 512],
    ['emoji and combining marks', '😀👩‍💻e\u0301\r\n'.repeat(60), 512],
    ['explicit larger budget', '正文😀é\n'.repeat(1500), 8192]
  ])(
    'splits %s without dropping, normalizing or breaking original code points',
    (_label, text, max) => {
      const chunks = splitEmbeddingText(text, max)
      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.join('')).toBe(text)
      const originalCodePoints = Array.from(text)
      let position = 0
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0)
        expect(estimateEmbeddingTokens(chunk)).toBeLessThanOrEqual(
          embeddingInputBudget(max).contentTokenBudget
        )
        const codePoints = Array.from(chunk)
        expect(codePoints).toEqual(originalCodePoints.slice(position, position + codePoints.length))
        expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/u)
        expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]/u)
        position += codePoints.length
      }
      expect(position).toBe(originalCodePoints.length)
    }
  )

  it('prefers a sentence or whitespace boundary when it fits before the hard limit', () => {
    const text = `hello world. ${'x'.repeat(12)}`
    const chunks = splitEmbeddingText(text, 32)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatch(/[.\s]$/u)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every((chunk) => estimateEmbeddingTokens(chunk) <= 16)).toBe(true)
  })

  it('rejects a code point whose normalization expansion cannot fit the content budget', () => {
    expect(() => splitEmbeddingText('ﷺ', 32)).toThrow(/input|budget|token|输入|长度|上限/iu)
  })

  it('accepts exact content limits and rejects one excess token anywhere in the group', () => {
    expect(() => assertEmbeddingInputBudget(['x'.repeat(496), 'é'.repeat(165)], 512)).not.toThrow()
    expect(() => assertEmbeddingInputBudget(['short', 'x'.repeat(497)], 512)).toThrow(
      /input|budget|token|输入|长度|上限/iu
    )
    expect(() => assertEmbeddingInputBudget(['x'.repeat(7987)], 8192)).not.toThrow()
    expect(() => assertEmbeddingInputBudget(['x'.repeat(7988)], 8192)).toThrow(
      /input|budget|token|输入|长度|上限/iu
    )
  })
})

describe('remote embedding input enforcement', () => {
  it.each([undefined, 512, 8192])(
    'rejects the entire oversized batch before HTTP for a total budget of %s',
    async (maxInputTokens) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
      const executor = new RemoteEmbeddingExecutor({ ...remoteModel, maxInputTokens, fetch })
      const contentLimit = maxInputTokens === 8192 ? 7987 : 496
      await expect(executor.embed(['short', 'x'.repeat(contentLimit + 1)])).rejects.toThrow(
        /input|budget|token|输入|长度|上限/iu
      )
      expect(fetch).not.toHaveBeenCalled()
      await executor.close()
    }
  )

  it.each([undefined, 512, 8192])(
    'keeps the short-text OpenAI request shape for a total budget of %s',
    async (maxInputTokens) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
      const executor = new RemoteEmbeddingExecutor({ ...remoteModel, maxInputTokens, fetch })
      await expect(executor.embed(['short query'])).resolves.toEqual(result)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
        model: remoteModel.modelName,
        input: ['short query'],
        encoding_format: 'float'
      })
      await executor.close()
    }
  )

  it('honors an explicit 8192 limit instead of applying the default 512 limit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
    const executor = new RemoteEmbeddingExecutor({ ...remoteModel, maxInputTokens: 8192, fetch })
    const text = 'x'.repeat(7987)
    await expect(executor.embed([text])).resolves.toEqual(result)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).input).toEqual([text])
    await executor.close()
  })
})

describe('EmbeddingService document input preparation', () => {
  it('expands remote document chunks while preserving every metadata field and the original input', async () => {
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(async () => undefined),
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })
    await service.configure({
      executor,
      modelName: 'bge-m3',
      identity: 'remote:budget',
      kind: 'remote',
      maxInputTokens: 512
    })
    const chunks = [
      {
        text: '正文é😀ﷺ。\n'.repeat(60),
        page: 7,
        metadata: { source: 'section-a' },
        marker: 'long'
      },
      { text: 'short text', page: 8, metadata: { source: 'section-b' }, marker: 'short' }
    ]
    const original = structuredClone(chunks)
    try {
      const prepared = service.prepareDocumentChunks(chunks)
      const expanded = prepared.filter((chunk) => chunk.marker === 'long')
      expect(expanded.length).toBeGreaterThan(1)
      expect(expanded.map((chunk) => chunk.text).join('')).toBe(chunks[0].text)
      for (const chunk of expanded) {
        expect(chunk).toEqual({ ...chunks[0], text: chunk.text })
        expect(estimateEmbeddingTokens(chunk.text)).toBeLessThanOrEqual(496)
      }
      expect(prepared.at(-1)).toEqual(chunks[1])
      expect(chunks).toEqual(original)
      expect(executor.embed).not.toHaveBeenCalled()
    } finally {
      await service.close()
    }
  })

  it('keeps local chunks and objects intact and applies a new budget after reconfiguration', async () => {
    const executor: EmbeddingExecutor = {
      initialize: vi.fn(async () => undefined),
      embed: vi.fn(async () => result)
    }
    const service = new EmbeddingService({ executor })
    const chunks = [{ text: 'x'.repeat(1200), page: 3 }]
    try {
      expect(service.prepareDocumentChunks(chunks)).toBe(chunks)
      expect(service.prepareDocumentChunks(chunks)[0]).toBe(chunks[0])
      await service.configure({
        executor,
        modelName: 'bge-m3',
        identity: 'remote:default',
        kind: 'remote'
      })
      const small = service.prepareDocumentChunks(chunks)
      expect(small.length).toBeGreaterThan(1)
      expect(small.every((chunk) => estimateEmbeddingTokens(chunk.text) <= 496)).toBe(true)
      await service.configure({
        executor,
        modelName: 'bge-m3',
        identity: 'remote:8192',
        kind: 'remote',
        maxInputTokens: 8192
      })
      expect(service.prepareDocumentChunks(chunks)).toEqual(chunks)
      await service.configure({
        executor,
        modelName: 'local-test',
        identity: LOCAL_EMBEDDING_MODEL_ID,
        kind: 'local'
      })
      expect(service.prepareDocumentChunks(chunks)).toBe(chunks)
    } finally {
      await service.close()
    }
  })

  it('rejects a long query clearly without truncating, splitting, HTTP or local fallback', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
    const local: EmbeddingExecutor = {
      initialize: vi.fn(async () => undefined),
      embed: vi.fn(async () => result)
    }
    const remote = new RemoteEmbeddingExecutor({ ...remoteModel, maxInputTokens: 512, fetch })
    const service = new EmbeddingService({ executor: local })
    await service.configure({
      executor: remote,
      modelName: remoteModel.modelName,
      identity: 'remote:query',
      kind: 'remote',
      maxInputTokens: 512
    })
    try {
      await expect(service.embed('x'.repeat(497))).rejects.toThrow(
        /缩短|shorten|超|exceed|budget/iu
      )
      expect(fetch).not.toHaveBeenCalled()
      expect(local.initialize).not.toHaveBeenCalled()
      expect(local.embed).not.toHaveBeenCalled()
    } finally {
      await service.close()
    }
  })
})

describe('EmbeddingModelService input budget configuration', () => {
  it('tests a connection with the smallest supported budget without exceeding its content limit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
    vi.stubGlobal('fetch', fetch)
    const { service, embeddingService } = createModelFixture()
    try {
      expect(await service.test({ ...remoteModel, maxInputTokens: 32 })).toBe(2)
      expect(fetch).toHaveBeenCalledTimes(1)
      const request = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as { input: string[] }
      expect(request.input.every((text) => estimateEmbeddingTokens(text) <= 16)).toBe(true)
    } finally {
      await service.close()
      await embeddingService.close()
    }
  })

  it.each(['BAAI/bge-m3', 'Qwen/Qwen3-Embedding-8B', 'unknown-model'])(
    'normalizes an old %s configuration and a new omitted limit to the same 512 identity',
    async (modelName) => {
      const model = { ...remoteModel, modelName }
      const { service, embeddingService, settingsStore } = createModelFixture(model)
      try {
        await service.initialize()
        const initialIdentity = embeddingService.getIndexIdentity()
        const initial = await service.getSnapshot()
        const saved = await service.saveRemote(model)
        expect(initial.remoteModels[0].maxInputTokens).toBe(512)
        expect(saved.remoteModels[0].maxInputTokens).toBe(512)
        expect(settingsStore.get().remoteModels[0].maxInputTokens).toBe(512)
        expect(embeddingService.getIndexIdentity()).toBe(initialIdentity)
        expect(initialIdentity).toBe(remoteEmbeddingIdentity({ ...model, maxInputTokens: 512 }))
        expect(JSON.stringify(saved)).not.toContain(model.apiKey)
        expect(saved.remoteModels[0]).not.toHaveProperty('apiKey')
      } finally {
        await service.close()
        await embeddingService.close()
      }
    }
  )

  it('preserves explicit 8192 in snapshots and changes identity without automatic indexing when the budget changes', async () => {
    const { service, embeddingService, documentsStore, settingsStore } = createModelFixture()
    try {
      await service.initialize()
      const previous = embeddingService.getIndexIdentity()
      const changed = { ...remoteModel, maxInputTokens: 8192 }
      const saved = await service.saveRemote(changed)
      const next = embeddingService.getIndexIdentity()
      expect(next).not.toBe(previous)
      expect(next).toBe(remoteEmbeddingIdentity(changed))
      expect(saved.remoteModels[0]).toMatchObject({ maxInputTokens: 8192, hasApiKey: true })
      expect(saved.remoteModels[0]).not.toHaveProperty('apiKey')
      expect(settingsStore.get().remoteModels[0].maxInputTokens).toBe(8192)
      expect(documentsStore.getEmbeddingIndexState).toHaveBeenLastCalledWith(next)
    } finally {
      await service.close()
      await embeddingService.close()
    }
  })

  it('includes the budget in identity while excluding display names and API keys', () => {
    const initial = { ...remoteModel, maxInputTokens: 512 }
    expect(remoteEmbeddingIdentity(remoteModel)).toBe(remoteEmbeddingIdentity(initial))
    expect(remoteEmbeddingIdentity({ ...initial, name: 'Renamed', apiKey: 'unit-new-key' })).toBe(
      remoteEmbeddingIdentity(initial)
    )
    expect(remoteEmbeddingIdentity({ ...initial, maxInputTokens: 8192 })).not.toBe(
      remoteEmbeddingIdentity(initial)
    )
  })

  it('includes the input policy version in the remote identity hash', async () => {
    const initial = remoteEmbeddingIdentity({ ...remoteModel, maxInputTokens: 512 })
    vi.resetModules()
    vi.doMock('../../../../../src/shared/embeddingModels', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../../../../src/shared/embeddingModels')>()),
      EMBEDDING_INPUT_POLICY_VERSION: 'unit-next-input-policy'
    }))
    try {
      const changed = await import('../../../../../src/main/services/vector/EmbeddingModelService')
      expect(changed.remoteEmbeddingIdentity({ ...remoteModel, maxInputTokens: 512 })).not.toBe(
        initial
      )
    } finally {
      vi.doUnmock('../../../../../src/shared/embeddingModels')
      vi.resetModules()
    }
  })

  it.each(['saveRemote', 'test'] as const)(
    '%s validates total budget bounds before persistence or HTTP',
    async (operation) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => embeddingResponse())
      vi.stubGlobal('fetch', fetch)
      const { service, embeddingService, settingsStore } = createModelFixture()
      const original = settingsStore.get()
      try {
        for (const maxInputTokens of [31, 1_048_577, 512.5, NaN, Infinity]) {
          await expect(service[operation]({ ...remoteModel, maxInputTokens })).rejects.toThrow(
            /32.*1048576/u
          )
        }
        expect(settingsStore.get()).toEqual(original)
        expect(fetch).not.toHaveBeenCalled()
      } finally {
        await service.close()
        await embeddingService.close()
      }
    }
  )
})
