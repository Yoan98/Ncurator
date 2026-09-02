import { ZodError } from 'zod/v4'

export const INTERNAL_RUN_FAILURE_MESSAGE = '运行失败，请重试。如果问题持续出现，请查看应用日志。'

export type LlmProviderErrorInput = {
  message: string
  httpStatus?: number
  providerCode?: string
  providerType?: string
  retryable?: boolean
  cause?: unknown
}

export class LlmProviderError extends Error {
  public readonly httpStatus?: number
  public readonly providerCode?: string
  public readonly providerType?: string
  public readonly retryable: boolean

  public constructor(input: LlmProviderErrorInput) {
    super(input.message, { cause: input.cause })
    this.name = 'LlmProviderError'
    this.httpStatus = input.httpStatus
    this.providerCode = input.providerCode
    this.providerType = input.providerType
    this.retryable = Boolean(input.retryable)
  }
}

export type LlmOutputIssue = {
  path: string
  message: string
}

export class LlmOutputError extends Error {
  public readonly issues?: LlmOutputIssue[]
  public readonly rawText?: string

  public constructor(input: {
    message: string
    issues?: LlmOutputIssue[]
    rawText?: string
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'LlmOutputError'
    this.issues = input.issues
    this.rawText = input.rawText
  }
}

export const isLlmProviderError = (error: unknown): error is LlmProviderError =>
  error instanceof LlmProviderError

export const isLlmOutputError = (error: unknown): error is LlmOutputError =>
  error instanceof LlmOutputError

export class LlmOutputTruncatedError extends Error {
  public readonly partialText: string

  public constructor(partialText: string) {
    super('模型输出达到长度限制。')
    this.name = 'LlmOutputTruncatedError'
    this.partialText = partialText
  }
}

export const isLlmOutputTruncatedError = (
  error: unknown
): error is LlmOutputTruncatedError => error instanceof LlmOutputTruncatedError

export class LlmInputTooLongError extends Error {
  public constructor() {
    super('当前输入超过模型上下文限制，请缩短后重试。')
    this.name = 'LlmInputTooLongError'
  }
}

export const isLlmInputTooLongError = (error: unknown): error is LlmInputTooLongError =>
  error instanceof LlmInputTooLongError


const readCause = (error: unknown): unknown =>
  error && typeof error === 'object' && 'cause' in error ? error.cause : undefined

export const findLlmProviderError = (error: unknown): LlmProviderError | undefined => {
  const visited = new Set<unknown>()
  let current: unknown = error
  while (current && !visited.has(current)) {
    if (isLlmProviderError(current)) return current
    visited.add(current)
    current = readCause(current)
  }
  return undefined
}

const findErrorChainText = (error: unknown): string => {
  const parts: string[] = []
  const visited = new Set<unknown>()
  let current: unknown = error
  while (current && !visited.has(current)) {
    visited.add(current)
    if (current instanceof Error) {
      parts.push(current.name, current.message)
    }
    if (typeof current === 'object') {
      const code = 'code' in current ? String(current.code || '') : ''
      if (code) parts.push(code)
    }
    current = readCause(current)
  }
  return parts.join(' ').toLowerCase()
}

export const toLlmOutputError = (error: unknown, rawText?: string): LlmOutputError => {
  if (isLlmOutputError(error)) return error
  if (error instanceof ZodError) {
    return new LlmOutputError({
      message: '模型返回内容不符合要求的结构。',
      issues: error.issues.slice(0, 3).map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : 'output',
        message: issue.message
      })),
      rawText,
      cause: error
    })
  }
  return new LlmOutputError({
    message: '模型返回内容无法解析。',
    issues: [
      {
        path: 'output',
        message: error instanceof Error ? error.message : String(error || 'unknown output error')
      }
    ],
    rawText,
    cause: error
  })
}

export type RendererRunFailure = {
  source: 'provider' | 'internal'
  message: string
  httpStatus?: number
  providerCode?: string
}

export const toRendererRunFailure = (error: unknown): RendererRunFailure => {
  const providerError = findLlmProviderError(error)
  if (providerError) {
    return {
      source: 'provider',
      message: providerError.message || '模型服务请求失败。',
      httpStatus: providerError.httpStatus,
      providerCode: providerError.providerCode
    }
  }
  const chainText = findErrorChainText(error)
  if (/(?:timeout|timed out|etimedout)/u.test(chainText)) {
    return {
      source: 'provider',
      message: '模型服务请求超时，请稍后重试。'
    }
  }
  if (/(?:network|fetch failed|socket|econn|enotfound|eai_again|dns)/u.test(chainText)) {
    return {
      source: 'provider',
      message: '无法连接模型服务，请检查网络后重试。'
    }
  }
  return {
    source: 'internal',
    message: INTERNAL_RUN_FAILURE_MESSAGE
  }
}
