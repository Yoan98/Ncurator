import {
  DEFAULT_EMBEDDING_INPUT_TOKENS,
  embeddingInputBudget
} from '../../../../shared/embeddingModels'
import { assertEmbeddingInputBudget } from './embeddingInputBudget'
import type { EmbeddingExecutor, EmbeddingResult } from './types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 500
const MAX_ERROR_BODY_BYTES = 8 * 1024
const ERROR_BODY_TIMEOUT_MS = 1_000
const MAX_ERROR_MESSAGE_LENGTH = 512

const normalizeErrorText = (value: string): string => {
  for (let pass = 0; pass < 2; pass += 1) {
    value = value
      .replace(/(?:%[\dA-Fa-f]{2})+/gu, (encoded) => {
        try {
          return decodeURIComponent(encoded)
        } catch {
          return encoded
        }
      })
      .replace(
        /\\(?:u[\dA-Fa-f]{4}|["\\/bfnrt])/gu,
        (escaped) => JSON.parse(`"${escaped}"`) as string
      )
  }
  return value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * 只提取白名单消息字段，先还原常见转义以删除密钥和回显输入，再压缩为有长度限制的单行诊断。
 *
 * Extract only allowlisted message fields, normalize common escapes to redact keys and echoed
 * input, then produce a bounded single-line diagnostic.
 */
const parseRemoteError = (value: unknown, apiKey: string, texts: string[]): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const root = value as Record<string, unknown>
  const error =
    root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : undefined
  const message = [error?.message, root.message, root.detail, root.error].find(
    (candidate): candidate is string => typeof candidate === 'string' && !!candidate.trim()
  )
  if (!message) return ''
  let summary = normalizeErrorText(message)
  for (const sensitive of [apiKey, ...texts]
    .map(normalizeErrorText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)) {
    summary = summary.split(sensitive).join('[redacted]')
  }
  return summary
    .replace(
      /\b(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|token|secret|password)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|(?:(?:bearer|basic)\s+)?[^\s,;'"<>]+)/giu,
      '[redacted]'
    )
    .replace(/\b(?:bearer|basic)\s+[^\s,;'"<>]+/giu, '[redacted]')
    .slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

/**
 * 错误体采用独立的字节和时间预算，并响应整体请求取消；不等待取消回调，避免异常服务拖住关闭。
 *
 * Read error bodies within separate byte and time budgets while honoring request cancellation.
 * Do not await stream cancellation, so a broken provider cannot delay shutdown.
 */
const readRemoteError = async (
  response: Response,
  signal: AbortSignal,
  apiKey: string,
  texts: string[]
): Promise<string> => {
  if (!response.body || signal.aborted) return ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: () => void = () => undefined
  try {
    const bodyReader = response.body.getReader()
    reader = bodyReader
    const deadline = new Promise<string>((resolve) => {
      onAbort = () => resolve('')
      signal.addEventListener('abort', onAbort, { once: true })
      timeout = setTimeout(onAbort, ERROR_BODY_TIMEOUT_MS)
    })
    const read = async (): Promise<string> => {
      const decoder = new TextDecoder()
      let bytes = 0
      let body = ''
      for (;;) {
        const { done, value } = await bodyReader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_ERROR_BODY_BYTES) return ''
        body += decoder.decode(value, { stream: true })
      }
      body += decoder.decode()
      return parseRemoteError(JSON.parse(body), apiKey, texts)
    }
    return await Promise.race([read(), deadline])
  } catch {
    return ''
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
    void reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
  }
}

class RemoteEmbeddingRequestError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message)
    this.name = 'RemoteEmbeddingRequestError'
  }
}

export const resolveEmbeddingUrl = (baseUrl: string): string => {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw new Error('Remote embedding baseUrl must be a valid HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Remote embedding baseUrl must be an HTTP(S) URL without credentials')
  }
  const pathname = url.pathname.replace(/\/+$/u, '')
  url.pathname = pathname.endsWith('/embeddings') ? pathname : `${pathname || '/v1'}/embeddings`
  url.hash = ''
  return url.toString()
}

/**
 * 在边界验证远程 JSON，并按输入索引恢复向量顺序。检查 Float32 转换结果，避免溢出和下溢后产生不可用向量。
 *
 * Validate remote JSON at the boundary and restore vectors to input order. Check the Float32
 * conversion to reject unusable vectors caused by overflow or underflow.
 */
const parseEmbeddingResponse = (value: unknown, count: number): EmbeddingResult => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('data' in value) ||
    !Array.isArray(value.data) ||
    value.data.length !== count
  ) {
    throw new Error(`Invalid remote embedding response: expected ${count} data items`)
  }

  const rows: unknown[] = value.data
  const indices = new Set<number>()
  let dimensions: number | null = null
  let data: Float32Array | null = null
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      !('index' in row) ||
      typeof row.index !== 'number' ||
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= count ||
      indices.has(row.index)
    ) {
      throw new Error('Invalid remote embedding response: indices must be unique and complete')
    }
    indices.add(row.index)
    if (!('embedding' in row) || !Array.isArray(row.embedding) || row.embedding.length === 0) {
      throw new Error('Invalid remote embedding response: embedding must be a non-empty array')
    }
    const vector: unknown[] = row.embedding
    dimensions ??= vector.length
    if (vector.length !== dimensions) {
      throw new Error('Invalid remote embedding response: vector dimensions must be consistent')
    }
    data ??= new Float32Array(count * dimensions)
    const offset = row.index * dimensions
    let nonZero = false
    for (let i = 0; i < dimensions; i += 1) {
      const component = vector[i]
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        throw new Error('Invalid remote embedding response: all components must be finite numbers')
      }
      data[offset + i] = component
      if (!Number.isFinite(data[offset + i])) {
        throw new Error('Invalid remote embedding response: component overflows Float32')
      }
      nonZero ||= data[offset + i] !== 0
    }
    if (!nonZero) {
      throw new Error('Invalid remote embedding response: Float32 vector must be non-zero')
    }
  }
  if (!data || dimensions === null) {
    throw new Error('Invalid remote embedding response: vectors must not be empty')
  }
  return { data, dims: [count, dimensions] }
}

/**
 * 使用 OpenAI 兼容端点执行嵌入，不探测模型、不回退到本地模型。仅重试限流、服务端错误和网络故障。
 *
 * Execute embeddings through an OpenAI-compatible endpoint without probing or falling back to a
 * local model. Retry only rate limiting, server errors, and network failures.
 */
export class RemoteEmbeddingExecutor implements EmbeddingExecutor {
  private readonly url: string
  private readonly apiKey: string
  private readonly modelName: string
  private readonly maxInputTokens: number
  private readonly fetchFn: typeof globalThis.fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly retryDelayMs: number
  private dimensions: number | null = null
  private closed = false
  private readonly requests = new Set<AbortController>()

  public constructor(input: {
    baseUrl: string
    apiKey: string
    modelName: string
    maxInputTokens?: number
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
    maxAttempts?: number
    retryDelayMs?: number
  }) {
    this.url = resolveEmbeddingUrl(input.baseUrl)
    this.apiKey = input.apiKey.trim()
    this.modelName = input.modelName.trim()
    this.maxInputTokens =
      input.maxInputTokens === undefined ? DEFAULT_EMBEDDING_INPUT_TOKENS : input.maxInputTokens
    this.fetchFn = input.fetch ?? globalThis.fetch
    this.timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    if (!this.apiKey || !this.modelName) {
      throw new Error('Remote embedding apiKey and modelName are required')
    }
    embeddingInputBudget(this.maxInputTokens)
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs <= 0 ||
      this.timeoutMs > 2_147_483_647
    ) {
      throw new Error('Remote embedding timeoutMs must be a positive timer interval')
    }
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('Remote embedding maxAttempts must be a positive integer')
    }
    if (
      !Number.isInteger(this.retryDelayMs) ||
      this.retryDelayMs < 0 ||
      this.retryDelayMs > 2_147_483_647
    ) {
      throw new Error('Remote embedding retryDelayMs must be a non-negative timer interval')
    }
  }

  public async initialize(): Promise<void> {
    this.assertOpen()
  }

  public async close(): Promise<void> {
    this.closed = true
    for (const controller of this.requests) controller.abort()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new RemoteEmbeddingRequestError('Remote embedding executor is closed', false)
    }
  }

  public async embed(texts: string[]): Promise<EmbeddingResult> {
    this.assertOpen()
    if (texts.length === 0) throw new Error('Remote embedding input must not be empty')
    assertEmbeddingInputBudget(texts, this.maxInputTokens)
    const payload = await this.requestWithRetries(texts)
    const result = parseEmbeddingResponse(payload, texts.length)
    const dimensions = result.dims[1]
    if (this.dimensions !== null && this.dimensions !== dimensions) {
      throw new Error(
        `Remote embedding dimension drift: expected ${this.dimensions}, received ${dimensions}`
      )
    }
    this.dimensions = dimensions
    return result
  }

  private async requestWithRetries(texts: string[]): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      this.assertOpen()
      try {
        return await this.request(texts)
      } catch (error) {
        if (
          !(error instanceof RemoteEmbeddingRequestError) ||
          !error.retryable ||
          attempt >= this.maxAttempts
        ) {
          throw error
        }
        if (this.retryDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs))
        }
      }
    }
  }

  private async request(texts: string[]): Promise<unknown> {
    const controller = new AbortController()
    this.requests.add(controller)
    let httpError: RemoteEmbeddingRequestError | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let onAbort: () => void = () => undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        reject(new RemoteEmbeddingRequestError('Remote embedding executor is closed', false))
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      timeout = setTimeout(() => {
        reject(
          httpError ??
            new RemoteEmbeddingRequestError(
              `Remote embedding request timed out after ${this.timeoutMs}ms`,
              true
            )
        )
        controller.abort()
      }, this.timeoutMs)
    })
    try {
      return await Promise.race([
        this.fetchResponse(texts, controller.signal, (error) => {
          httpError = error
        }),
        deadline
      ])
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', onAbort)
      this.requests.delete(controller)
    }
  }

  private async fetchResponse(
    texts: string[],
    signal: AbortSignal,
    onHttpError: (error: RemoteEmbeddingRequestError) => void
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: this.modelName, input: texts, encoding_format: 'float' }),
        signal
      })
    } catch {
      throw new RemoteEmbeddingRequestError('Remote embedding network request failed', true)
    }
    if (!response.ok) {
      const error = new RemoteEmbeddingRequestError(
        `Remote embedding request failed: HTTP ${response.status}`,
        response.status === 429 || (response.status >= 500 && response.status <= 599)
      )
      onHttpError(error)
      const detail = await readRemoteError(response, signal, this.apiKey, texts)
      if (detail) error.message += `: ${detail}`
      throw error
    }
    let body: string
    try {
      body = await response.text()
    } catch {
      throw new RemoteEmbeddingRequestError('Remote embedding response could not be read', true)
    }
    try {
      return JSON.parse(body)
    } catch {
      throw new RemoteEmbeddingRequestError(
        'Invalid remote embedding response: malformed JSON',
        false
      )
    }
  }
}
