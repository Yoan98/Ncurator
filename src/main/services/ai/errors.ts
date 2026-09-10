import { ZodError } from 'zod/v4'

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
  public readonly retryable: boolean

  public constructor(input: {
    message: string
    issues?: LlmOutputIssue[]
    rawText?: string
    retryable?: boolean
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'LlmOutputError'
    this.issues = input.issues
    this.rawText = input.rawText
    this.retryable = Boolean(input.retryable)
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

export const toLlmOutputError = (
  error: unknown,
  rawText?: string,
  retryable?: boolean
): LlmOutputError => {
  const shouldRetry = Boolean(retryable)
  if (isLlmOutputError(error)) {
    if (!shouldRetry || error.retryable) return error
    return new LlmOutputError({
      message: error.message,
      issues: error.issues,
      rawText: rawText || error.rawText,
      retryable: true,
      cause: error
    })
  }
  if (error instanceof ZodError) {
    return new LlmOutputError({
      message: '模型返回内容不符合要求的结构。',
      issues: error.issues.slice(0, 3).map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : 'output',
        message: issue.message
      })),
      rawText,
      retryable: shouldRetry,
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
    retryable: shouldRetry,
    cause: error
  })
}
