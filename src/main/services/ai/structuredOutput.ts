import type {
  AiStructuredOutputMethod,
  AiStructuredOutputProfile,
  AiStructuredOutputTransport,
  PreferredStructuredOutputProfile
} from '../../../shared/types'

export const NATIVE_STRUCTURED_OUTPUT_METHODS = ['jsonSchema', 'jsonMode'] as const
export const STRUCTURED_OUTPUT_METHODS = [...NATIVE_STRUCTURED_OUTPUT_METHODS, 'promptJson'] as const
export const COMPLETIONS_STRUCTURED_OUTPUT_PROFILES = [
  'completions:jsonSchema',
  'completions:jsonMode',
  'completions:promptJson'
] as const
export const RESPONSES_STRUCTURED_OUTPUT_PROFILES = [
  'responses:jsonSchema',
  'responses:promptJson'
] as const
export const STRUCTURED_OUTPUT_PROFILES = [
  ...COMPLETIONS_STRUCTURED_OUTPUT_PROFILES,
  ...RESPONSES_STRUCTURED_OUTPUT_PROFILES
] as const

export type NativeStructuredOutputMethod = (typeof NATIVE_STRUCTURED_OUTPUT_METHODS)[number]
export type NonScriptedStructuredOutputMethod = Exclude<AiStructuredOutputMethod, 'scripted'>

type ErrorResponseData = string | number | boolean | null | object

type ErrorLike =
  | Error
  | {
      message?: string
      response?: {
        data?: ErrorResponseData
      }
    }

export type StructuredOutputProfileMetadata = {
  transport: AiStructuredOutputTransport
  method: NonScriptedStructuredOutputMethod
}

const STRUCTURED_OUTPUT_PROFILE_METADATA: Record<
  PreferredStructuredOutputProfile,
  StructuredOutputProfileMetadata
> = {
  'completions:jsonSchema': {
    transport: 'completions',
    method: 'jsonSchema'
  },
  'completions:jsonMode': {
    transport: 'completions',
    method: 'jsonMode'
  },
  'completions:promptJson': {
    transport: 'completions',
    method: 'promptJson'
  },
  'responses:jsonSchema': {
    transport: 'responses',
    method: 'jsonSchema'
  },
  'responses:promptJson': {
    transport: 'responses',
    method: 'promptJson'
  }
}

const toErrorLike = (value: unknown): ErrorLike => {
  if (value instanceof Error) return value
  if (value && typeof value === 'object') {
    return value as Extract<ErrorLike, object>
  }
  return {
    message: String(value || 'unknown structured output error')
  }
}

export const getErrorText = (error: unknown): string => {
  const normalized = toErrorLike(error)
  if (normalized instanceof Error && normalized.message.trim()) {
    return normalized.message.trim()
  }
  if (typeof normalized.message === 'string' && normalized.message.trim()) {
    return normalized.message.trim()
  }
  return 'unknown structured output error'
}

const getStructuredOutputErrorBody = (
  error: unknown
): string => {
  const normalized = toErrorLike(error)
  const parts = [getErrorText(normalized)]
  const responseData =
    'response' in normalized &&
    normalized.response &&
    typeof normalized.response === 'object' &&
    'data' in normalized.response
      ? normalized.response.data
      : undefined
  if (responseData !== undefined) {
    try {
      parts.push(JSON.stringify(responseData))
    } catch {
      parts.push(String(responseData))
    }
  }
  return parts.join(' ')
}

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
    'unrecognized request argument',
    'unsupported parameter'
  ]
  return unsupportedSignals.some((signal) => body.includes(signal)) &&
    markers.some((marker) => body.includes(marker))
}

export const isTransportCompatibilityError = (
  transport: AiStructuredOutputTransport,
  error: unknown
): boolean => {
  const body = getStructuredOutputErrorBody(error).toLowerCase()
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

export const isStructuredOutputTransportCompatibilityError = isTransportCompatibilityError

export const isStructuredOutputMethodUnsupportedError = (
  method: NativeStructuredOutputMethod,
  error: unknown
): boolean => {
  const body = getStructuredOutputErrorBody(error).toLowerCase()
  if (!body) return false

  if (method === 'jsonSchema') {
    const invalidSchemaSignals = [
      'invalid schema for response_format',
      'invalid schema for response format',
      "'required' is required to be supplied",
      "missing 'required'",
      'missing required'
    ]
    if (
      invalidSchemaSignals.some((signal) => body.includes(signal)) &&
      ['response_format', 'response format', 'json_schema', 'json schema'].some((marker) =>
        body.includes(marker)
      )
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

export const buildStructuredOutputProfile = (
  transport: AiStructuredOutputTransport,
  method: NonScriptedStructuredOutputMethod
): PreferredStructuredOutputProfile => {
  if (transport === 'completions') {
    if (method === 'jsonSchema') return 'completions:jsonSchema'
    if (method === 'jsonMode') return 'completions:jsonMode'
    if (method === 'promptJson') return 'completions:promptJson'
    throw new Error(`structured_output_invalid_profile_combo:${transport}:${method}`)
  }

  if (method === 'jsonSchema') return 'responses:jsonSchema'
  if (method === 'promptJson') return 'responses:promptJson'
  throw new Error(`structured_output_invalid_profile_combo:${transport}:${method}`)
}

export const resolveStructuredOutputProfile = (
  profile: PreferredStructuredOutputProfile
): StructuredOutputProfileMetadata => STRUCTURED_OUTPUT_PROFILE_METADATA[profile]

export const buildStructuredOutputAttemptOrder = (
  preferredProfile?: PreferredStructuredOutputProfile
): PreferredStructuredOutputProfile[] => {
  if (!preferredProfile) {
    return [...STRUCTURED_OUTPUT_PROFILES]
  }
  return [
    preferredProfile,
    ...STRUCTURED_OUTPUT_PROFILES.filter((profile) => profile !== preferredProfile)
  ]
}

export const getTransportBoundaryIndex = (
  attemptOrder: PreferredStructuredOutputProfile[],
  startIndex: number
): number => {
  const currentTransport = resolveStructuredOutputProfile(attemptOrder[startIndex]).transport
  let nextIndex = startIndex
  while (nextIndex + 1 < attemptOrder.length) {
    const nextTransport = resolveStructuredOutputProfile(attemptOrder[nextIndex + 1]).transport
    if (nextTransport !== currentTransport) break
    nextIndex += 1
  }
  return nextIndex
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

export const parsePromptJsonOutput = (raw: string): Record<string, unknown> => {
  const normalized = normalizePromptJsonText(raw)
  if (!normalized) {
    throw new Error('prompt_json_empty_response')
  }

  const parsed = JSON.parse(normalized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('prompt_json_non_object_response')
  }

  return parsed as Record<string, unknown>
}

export const parseJsonObjectText = (raw: string): Record<string, unknown> => {
  const normalized = normalizePromptJsonText(raw)
  if (!normalized) {
    throw new Error('structured_output_empty_response')
  }

  const parsed = JSON.parse(normalized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('structured_output_non_object_response')
  }

  return parsed as Record<string, unknown>
}

export const resolveResultProfile = (input: {
  method: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
}): AiStructuredOutputProfile => {
  if (input.profile) {
    return input.profile
  }

  if (input.method === 'scripted') {
    return 'scripted'
  }

  if (input.transport) {
    return buildStructuredOutputProfile(input.transport, input.method)
  }

  throw new Error('structured_output_driver_missing_profile')
}
