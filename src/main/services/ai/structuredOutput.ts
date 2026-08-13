import { jsonrepair } from 'jsonrepair'

type ErrorObject = Record<string, unknown>

export type StructuredOutputErrorInfo = {
  status?: number
  code?: string
  type?: string
  param?: string
  message: string
  rawText: string
}

export type LlmErrorClassification = 'fatal' | 'retryable' | 'unknown'

const getObject = (value: unknown): ErrorObject | undefined =>
  value && typeof value === 'object' ? (value as ErrorObject) : undefined

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const stringifyValue = (value: unknown): string | undefined => {
  const direct = readString(value)
  if (direct) return direct
  if (value === undefined) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const normalizeSignal = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const normalized = value.trim()
  return normalized ? normalized.toLowerCase() : undefined
}

const stripSdkErrorDecoration = (message: string): string =>
  message.replace(/\n\s*Troubleshooting URL:\s*https?:\/\/\S+[\s\S]*$/iu, '').trim()

export const normalizeStructuredOutputError = (error: unknown): StructuredOutputErrorInfo => {
  const root = getObject(error)
  const response = getObject(root?.response)
  const responseData = response?.data as ErrorResponseData | undefined
  const responseDataObject = getObject(responseData)
  const providerError = getObject(responseDataObject?.error)

  const message = stripSdkErrorDecoration(
    readString(providerError?.message) ||
      readString(responseDataObject?.message) ||
      readString(root?.message) ||
      stringifyValue(responseData) ||
      stringifyValue(error) ||
      'unknown structured output error'
  )

  const status =
    readNumber(response?.status) ||
    readNumber(root?.status) ||
    readNumber(responseDataObject?.status) ||
    readNumber(providerError?.status)

  const code =
    readString(providerError?.code) ||
    readString(responseDataObject?.code) ||
    readString(root?.code)

  const type =
    readString(providerError?.type) ||
    readString(responseDataObject?.type) ||
    readString(root?.type)

  const param =
    readString(providerError?.param) ||
    readString(responseDataObject?.param) ||
    readString(root?.param)

  const rawParts = [
    status !== undefined ? `status=${status}` : undefined,
    code ? `code=${code}` : undefined,
    type ? `type=${type}` : undefined,
    param ? `param=${param}` : undefined,
    message,
    stringifyValue(responseData)
  ].filter(Boolean)

  return {
    status,
    code,
    type,
    param,
    message,
    rawText: rawParts.join(' ')
  }
}

export const getErrorText = (error: unknown): string =>
  normalizeStructuredOutputError(error).message

type ErrorResponseData = string | number | boolean | null | object

const FATAL_STATUS_CODES = new Set([401, 402, 403])
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const FATAL_ERROR_CODES = new Set([
  'invalid_api_key',
  'insufficient_balance',
  'quota_exceeded',
  'invalid_authentication',
  'authentication_error'
])
const RETRYABLE_ERROR_CODES = new Set([
  'rate_limit_exceeded',
  'timeout',
  'request_timeout',
  'server_error',
  'service_unavailable'
])

export const classifyLlmError = (error: unknown): LlmErrorClassification => {
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

export const isFatalLlmError = (error: unknown): boolean => classifyLlmError(error) === 'fatal'
export const isRetryableLlmError = (error: unknown): boolean =>
  classifyLlmError(error) === 'retryable'

export const extractTextContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        if ('text' in part && typeof part.text === 'string') return part.text
        if ('content' in part && typeof part.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    if ('text' in content && typeof content.text === 'string') {
      return content.text
    }
    if ('content' in content && typeof content.content === 'string') {
      return content.content
    }
  }

  return ''
}

export const normalizePromptJsonText = (raw: string): string => {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

const parseJsonObject = (normalized: string): Record<string, unknown> => {
  const parsed = JSON.parse(normalized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('structured_output_non_object_response')
  }
  return parsed as Record<string, unknown>
}

const parseRepairableJsonObjectText = (raw: string, emptyCode: string): Record<string, unknown> => {
  const normalized = normalizePromptJsonText(raw)
  if (!normalized) {
    throw new Error(emptyCode)
  }

  try {
    return parseJsonObject(normalized)
  } catch (error) {
    try {
      return parseJsonObject(jsonrepair(normalized))
    } catch {
      throw error
    }
  }
}

export const parsePromptJsonOutput = (raw: string): Record<string, unknown> => {
  return parseRepairableJsonObjectText(raw, 'prompt_json_empty_response')
}

export const parseJsonObjectText = (raw: string): Record<string, unknown> => {
  return parseRepairableJsonObjectText(raw, 'structured_output_empty_response')
}
