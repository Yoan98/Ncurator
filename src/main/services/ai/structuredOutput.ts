import { jsonrepair } from 'jsonrepair'
import type {
  AiStructuredOutputMethod,
  AiStructuredOutputTransport,
  StructuredOutputMode,
  StructuredOutputStrategy
} from '../../../shared/types'

export const NATIVE_STRUCTURED_OUTPUT_METHODS = ['jsonSchema', 'jsonMode'] as const
export const STRUCTURED_OUTPUT_METHODS = [...NATIVE_STRUCTURED_OUTPUT_METHODS, 'promptJson'] as const

export type NativeStructuredOutputMethod = (typeof NATIVE_STRUCTURED_OUTPUT_METHODS)[number]
export type NonScriptedStructuredOutputMethod = Exclude<AiStructuredOutputMethod, 'scripted'>

type ErrorResponseData = string | number | boolean | null | object

type ErrorObject = Record<string, unknown>

export type StructuredOutputErrorKind = 'fatal' | 'retryable' | 'capability_mismatch' | 'unknown'

export type StructuredOutputErrorInfo = {
  status?: number
  code?: string
  type?: string
  param?: string
  message: string
  rawText: string
}

export type StructuredOutputErrorAnalysis = {
  info: StructuredOutputErrorInfo
  kind: StructuredOutputErrorKind
  transportCompatibility: boolean
  methodUnsupported: boolean
}

export type StructuredOutputStrategyMetadata = {
  transport: AiStructuredOutputTransport
  mode: StructuredOutputMode
  method: NonScriptedStructuredOutputMethod
}

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

const includesAny = (body: string, markers: string[]): boolean =>
  markers.some((marker) => body.includes(marker))

const normalizeSignal = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const normalized = value.trim()
  return normalized ? normalized.toLowerCase() : undefined
}

export const normalizeStructuredOutputError = (error: unknown): StructuredOutputErrorInfo => {
  const root = getObject(error)
  const response = getObject(root?.response)
  const responseData = response?.data as ErrorResponseData | undefined
  const responseDataObject = getObject(responseData)
  const providerError = getObject(responseDataObject?.error)

  const message =
    readString(providerError?.message) ||
    readString(responseDataObject?.message) ||
    readString(root?.message) ||
    stringifyValue(responseData) ||
    stringifyValue(error) ||
    'unknown structured output error'

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

export const getErrorText = (error: unknown): string => normalizeStructuredOutputError(error).message

const matchesUnsupportedSignal = (body: string, markers: string[]): boolean => {
  const unsupportedSignals = [
    'not supported',
    'unsupported',
    'does not support',
    'is not supported',
    'unknown parameter',
    'invalid parameter',
    'invalid value',
    'not allowed',
    'not available',
    'unavailable',
    'unrecognized request argument',
    'unsupported parameter'
  ]
  return includesAny(body, unsupportedSignals) && includesAny(body, markers)
}

const isTransportCompatibilityErrorInfo = (
  transport: AiStructuredOutputTransport,
  info: StructuredOutputErrorInfo
): boolean => {
  const body = info.rawText.toLowerCase()
  if (!body) return false

  const providerCompatibilitySignals = [
    "cannot read properties of undefined (reading 'map')",
    'cannot read properties of undefined (reading "map")',
    "cannot read properties of undefined (reading 'message')",
    'cannot read properties of undefined (reading "message")'
  ]
  if (providerCompatibilitySignals.some((signal) => body.includes(signal))) {
    return true
  }

  if (
    transport === 'completions' &&
    includesAny(normalizeSignal(info.type) || '', ['unsupported_legacy_protocol'])
  ) {
    return true
  }

  if (transport === 'completions') {
    if (body.includes('/v1/chat/completions') && body.includes('please use /v1/responses')) {
      return true
    }
    return matchesUnsupportedSignal(body, [
      '/v1/chat/completions',
      'chat/completions',
      'legacy protocol'
    ])
  }

  return matchesUnsupportedSignal(body, ['/v1/responses', 'responses api', 'responses endpoint'])
}

const isMethodUnsupportedErrorInfo = (
  method: NativeStructuredOutputMethod,
  info: StructuredOutputErrorInfo
): boolean => {
  const body = info.rawText.toLowerCase()
  if (!body) return false

  const normalizedParam = normalizeSignal(info.param)
  if (
    normalizedParam &&
    (normalizedParam === 'response_format' ||
      normalizedParam === 'response_format.type' ||
      normalizedParam === 'json_schema')
  ) {
    return true
  }

  if (method === 'jsonSchema') {
    const invalidSchemaSignals = [
      'invalid schema for response_format',
      'invalid schema for response format',
      "'required' is required to be supplied",
      "missing 'required'",
      'missing required'
    ]
    if (
      includesAny(body, invalidSchemaSignals) &&
      includesAny(body, ['response_format', 'response format', 'json_schema', 'json schema'])
    ) {
      return true
    }

    return matchesUnsupportedSignal(body, [
      'json schema',
      'json_schema',
      'response_format',
      'response format'
    ])
  }

  return matchesUnsupportedSignal(body, [
    'json mode',
    'json_object',
    'response_format',
    'response format'
  ])
}

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

export const classifyStructuredOutputError = (input: {
  error: unknown
  transport: AiStructuredOutputTransport
  method: NonScriptedStructuredOutputMethod
}): StructuredOutputErrorAnalysis => {
  const info = normalizeStructuredOutputError(input.error)
  const normalizedCode = normalizeSignal(info.code)
  const normalizedType = normalizeSignal(info.type)
  const body = info.rawText.toLowerCase()
  const transportCompatibility = isTransportCompatibilityErrorInfo(input.transport, info)
  const methodUnsupported =
    input.method !== 'promptJson' && isMethodUnsupportedErrorInfo(input.method, info)

  if (
    (info.status !== undefined && FATAL_STATUS_CODES.has(info.status)) ||
    (normalizedCode && FATAL_ERROR_CODES.has(normalizedCode)) ||
    includesAny(body, ['insufficient balance', 'invalid api key', 'authentication failed']) ||
    normalizedType === 'authentication_error'
  ) {
    return {
      info,
      kind: 'fatal',
      transportCompatibility,
      methodUnsupported
    }
  }

  if (
    (info.status !== undefined && RETRYABLE_STATUS_CODES.has(info.status)) ||
    (normalizedCode && RETRYABLE_ERROR_CODES.has(normalizedCode)) ||
    includesAny(body, [
      'rate limit',
      'temporarily unavailable',
      'service unavailable',
      'timed out',
      'timeout'
    ])
  ) {
    return {
      info,
      kind: 'retryable',
      transportCompatibility,
      methodUnsupported
    }
  }

  if (transportCompatibility || methodUnsupported) {
    return {
      info,
      kind: 'capability_mismatch',
      transportCompatibility,
      methodUnsupported
    }
  }

  return {
    info,
    kind: 'unknown',
    transportCompatibility,
    methodUnsupported
  }
}

export const isTransportCompatibilityError = (
  transport: AiStructuredOutputTransport,
  error: unknown
): boolean => classifyStructuredOutputError({ error, transport, method: 'promptJson' }).transportCompatibility

export const isStructuredOutputTransportCompatibilityError = isTransportCompatibilityError

export const isStructuredOutputMethodUnsupportedError = (
  method: NativeStructuredOutputMethod,
  error: unknown
): boolean => classifyStructuredOutputError({ error, transport: 'completions', method }).methodUnsupported

export const modeToStructuredOutputMethod = (
  mode: StructuredOutputMode
): NonScriptedStructuredOutputMethod => {
  if (mode === 'json_schema') return 'jsonSchema'
  if (mode === 'json_object') return 'jsonMode'
  return 'promptJson'
}

export const methodToStructuredOutputMode = (
  method: NonScriptedStructuredOutputMethod
): StructuredOutputMode => {
  if (method === 'jsonSchema') return 'json_schema'
  if (method === 'jsonMode') return 'json_object'
  return 'prompt_json'
}

export const formatStructuredOutputStrategy = (strategy: StructuredOutputStrategy): string =>
  `${strategy.transport}/${strategy.mode}`

export const resolveStructuredOutputStrategy = (
  strategy: StructuredOutputStrategy
): StructuredOutputStrategyMetadata => {
  const method = modeToStructuredOutputMethod(strategy.mode)
  if (!isStructuredOutputStrategyCompatible(strategy)) {
    throw new Error(`structured_output_invalid_strategy:${formatStructuredOutputStrategy(strategy)}`)
  }
  return {
    ...strategy,
    method
  }
}

const STRUCTURED_OUTPUT_TRANSPORT_PREFERENCE: AiStructuredOutputTransport[] = [
  'responses',
  'completions'
]
const STRUCTURED_OUTPUT_MODE_PREFERENCE: StructuredOutputMode[] = [
  'json_schema',
  'json_object',
  'prompt_json'
]

export const isStructuredOutputStrategyCompatible = (
  strategy: StructuredOutputStrategy
): boolean => {
  if (strategy.transport === 'responses') return strategy.mode !== 'json_object'
  return true
}

const strategyKey = (strategy: StructuredOutputStrategy): string =>
  `${strategy.transport}:${strategy.mode}`

export const buildStructuredOutputStrategyAttemptOrder = (input: {
  supportedTransports: readonly AiStructuredOutputTransport[]
  preferredStrategy?: StructuredOutputStrategy
  supportedModes?: readonly StructuredOutputMode[]
}): StructuredOutputStrategy[] => {
  const supportedTransportSet = new Set(input.supportedTransports)
  const supportedModeSet = new Set(input.supportedModes || STRUCTURED_OUTPUT_MODE_PREFERENCE)
  const strategies = STRUCTURED_OUTPUT_TRANSPORT_PREFERENCE.flatMap((transport) =>
    STRUCTURED_OUTPUT_MODE_PREFERENCE.map((mode) => ({ transport, mode }))
  ).filter(
    (strategy) =>
      supportedTransportSet.has(strategy.transport) &&
      supportedModeSet.has(strategy.mode) &&
      isStructuredOutputStrategyCompatible(strategy)
  )

  const ordered = input.preferredStrategy
    ? [input.preferredStrategy, ...strategies]
    : strategies
  const seen = new Set<string>()
  return ordered.filter((strategy) => {
    if (
      !supportedTransportSet.has(strategy.transport) ||
      !supportedModeSet.has(strategy.mode) ||
      !isStructuredOutputStrategyCompatible(strategy)
    ) {
      return false
    }
    const key = strategyKey(strategy)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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

