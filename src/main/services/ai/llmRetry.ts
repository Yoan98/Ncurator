import { isLlmOutputError } from './errors'
import { normalizeStructuredOutputError } from './structuredOutput'
import { isCancelledError } from './utils/runFailure'

export type LlmErrorClassification = 'fatal' | 'retryable' | 'unknown'

export type LlmRetryDecision = {
  retryable: boolean
  message: string
  delayMs?: number
}

export const FATAL_STATUS_CODES = new Set([401, 402, 403])
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
export const FATAL_ERROR_CODES = new Set([
  'invalid_api_key',
  'insufficient_balance',
  'quota_exceeded',
  'invalid_authentication',
  'authentication_error'
])
export const RETRYABLE_ERROR_CODES = new Set([
  'rate_limit_exceeded',
  'timeout',
  'request_timeout',
  'server_error',
  'service_unavailable',
  'resource_exhausted'
])

const TRANSPORT_CONSTRUCTOR_NAMES = new Set(['APIConnectionError', 'APIConnectionTimeoutError'])

const normalizeSignal = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const normalized = value.trim()
  return normalized ? normalized.toLowerCase() : undefined
}

const readCause = (error: unknown): unknown =>
  error && typeof error === 'object' && 'cause' in error ? error.cause : undefined

const readConstructorName = (error: unknown): string => {
  if (!error || typeof error !== 'object') return ''
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name
  return typeof name === 'string' ? name : ''
}

const readErrorName = (error: unknown): string =>
  error && typeof error === 'object' && 'name' in error ? String(error.name || '') : ''

const isTransportErrorNode = (error: unknown): boolean => {
  const constructorName = readConstructorName(error)
  if (constructorName && TRANSPORT_CONSTRUCTOR_NAMES.has(constructorName)) return true
  return readErrorName(error) === 'TimeoutError'
}

export const isLlmTransportError = (error: unknown): boolean =>
  isTransportErrorNode(error) || isTransportErrorNode(readCause(error))

const isRateLimitOrCapacityError = (info: {
  status?: number
  code?: string
}): boolean => {
  if (info.status === 429) return true
  const normalizedCode = normalizeSignal(info.code)
  return normalizedCode === 'rate_limit_exceeded' || normalizedCode === 'resource_exhausted'
}

const resolveCapacityBackoffDelay = (attempt: number): number =>
  Math.min(15_000, 2_000 * 2 ** Math.max(0, attempt - 1))

export const classifyLlmErrorKind = (error: unknown): LlmErrorClassification => {
  const info = normalizeStructuredOutputError(error)
  const normalizedCode = normalizeSignal(info.code)
  const normalizedType = normalizeSignal(info.type)

  if (
    (info.status !== undefined && FATAL_STATUS_CODES.has(info.status)) ||
    (normalizedCode && FATAL_ERROR_CODES.has(normalizedCode)) ||
    normalizedType === 'authentication_error'
  ) {
    return 'fatal'
  }

  if (
    (info.status !== undefined && RETRYABLE_STATUS_CODES.has(info.status)) ||
    (normalizedCode && RETRYABLE_ERROR_CODES.has(normalizedCode)) ||
    isLlmTransportError(error)
  ) {
    return 'retryable'
  }

  return 'unknown'
}

export const classifyLlmRetry = (
  error: unknown,
  attempt = 1
): LlmRetryDecision => {
  const info = normalizeStructuredOutputError(error)
  const message = info.message || 'unknown'

  // Do not trust LlmProviderError.retryable; always reclassify from signals.
  if (isCancelledError(error)) {
    return { retryable: false, message }
  }

  if (isLlmOutputError(error) && error.retryable) {
    return { retryable: true, message }
  }

  const kind = classifyLlmErrorKind(error)
  if (kind !== 'retryable') {
    return { retryable: false, message }
  }

  return {
    retryable: true,
    message,
    ...(isRateLimitOrCapacityError(info) ? { delayMs: resolveCapacityBackoffDelay(attempt) } : {})
  }
}

/** Compatibility alias for older imports. */
export const classifyLlmError = classifyLlmErrorKind

export const isFatalLlmError = (error: unknown): boolean => classifyLlmErrorKind(error) === 'fatal'
export const isRetryableLlmError = (error: unknown): boolean =>
  classifyLlmErrorKind(error) === 'retryable'
