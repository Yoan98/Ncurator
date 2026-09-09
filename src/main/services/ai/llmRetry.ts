import { normalizeStructuredOutputError } from './structuredOutput'

export type LlmErrorClassification = 'fatal' | 'retryable' | 'unknown'

export type LlmRetryDecision = {
  retryable: boolean
  message: string
  delayMs?: number
}

export const FATAL_STATUS_CODES = new Set([401, 402, 403])
export const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
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

const normalizeSignal = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const normalized = value.trim()
  return normalized ? normalized.toLowerCase() : undefined
}

const isCancellationError = (error: unknown): boolean => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase()
  return code === 'CANCELLED' || message.includes('cancel')
}

const isResourceExhaustedError = (error: unknown, extraText = ''): boolean => {
  const message = `${error instanceof Error ? error.message : String(error || '')} ${extraText}`
  return /resourceexhausted|worker local total request limit/i.test(message)
}

const resolveResourceExhaustedDelay = (attempt: number): number =>
  Math.min(15_000, 2_000 * 2 ** Math.max(0, attempt - 1))

export const classifyLlmErrorKind = (error: unknown): LlmErrorClassification => {
  const info = normalizeStructuredOutputError(error)
  const normalizedCode = normalizeSignal(info.code)
  const normalizedType = normalizeSignal(info.type)
  const body = info.rawText.toLowerCase()

  if (
    (info.status !== undefined && FATAL_STATUS_CODES.has(info.status)) ||
    (normalizedCode && FATAL_ERROR_CODES.has(normalizedCode)) ||
    body.includes('insufficient balance') ||
    body.includes('invalid api key') ||
    body.includes('authentication failed') ||
    normalizedType === 'authentication_error'
  ) {
    return 'fatal'
  }

  if (
    (info.status !== undefined && RETRYABLE_STATUS_CODES.has(info.status)) ||
    (normalizedCode && RETRYABLE_ERROR_CODES.has(normalizedCode)) ||
    body.includes('rate limit') ||
    body.includes('temporarily unavailable') ||
    body.includes('service unavailable') ||
    body.includes('timed out') ||
    body.includes('timeout')
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
  const body = `${info.rawText} ${error instanceof Error ? error.message : ''}`.toLowerCase()

  // Do not trust LlmProviderError.retryable; always reclassify from signals.
  if (isCancellationError(error)) {
    return { retryable: false, message }
  }

  if (body.includes('structured_output_retryable') || body.includes('text_output_retryable')) {
    return {
      retryable: true,
      message,
      ...(isResourceExhaustedError(error, `${info.rawText} ${info.code} ${info.message}`)
        ? { delayMs: resolveResourceExhaustedDelay(attempt) }
        : {})
    }
  }

  const kind = classifyLlmErrorKind(error)
  if (kind !== 'retryable') {
    return { retryable: false, message }
  }

  return {
    retryable: true,
    message,
    ...(isResourceExhaustedError(error, `${info.rawText} ${info.code} ${info.message}`)
      ? { delayMs: resolveResourceExhaustedDelay(attempt) }
      : {})
  }
}

/** Compatibility alias for older imports. */
export const classifyLlmError = classifyLlmErrorKind

export const isFatalLlmError = (error: unknown): boolean => classifyLlmErrorKind(error) === 'fatal'
export const isRetryableLlmError = (error: unknown): boolean =>
  classifyLlmErrorKind(error) === 'retryable'
