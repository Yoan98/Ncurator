import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod/v4'
import { createChatModel } from '../llm/chatModel'
import type {
  AiStructuredOutputMethod,
  AiStructuredOutputProfile,
  AiStructuredOutputTransport,
  LLMConfig,
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

type NativeStructuredOutputMethod = (typeof NATIVE_STRUCTURED_OUTPUT_METHODS)[number]
type NonScriptedStructuredOutputMethod = Exclude<AiStructuredOutputMethod, 'scripted'>

type StructuredOutputInvocationInput<T extends Record<string, unknown>> = {
  caller: string
  cfg: LLMConfig
  preferredProfile?: PreferredStructuredOutputProfile
  schema: z.ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
}

export type StructuredOutputInvocationResult<T extends Record<string, unknown>> = {
  output: T
  method: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile: AiStructuredOutputProfile
  fallbackChain: AiStructuredOutputProfile[]
}

export type StructuredOutputDriverResult = {
  output: unknown
  method: AiStructuredOutputMethod
  transport?: AiStructuredOutputTransport
  profile?: AiStructuredOutputProfile
  fallbackChain?: AiStructuredOutputProfile[]
}

export type StructuredOutputDriver = (
  input: StructuredOutputInvocationInput<Record<string, unknown>>
) => Promise<StructuredOutputDriverResult>

type ErrorResponseData = string | number | boolean | null | object

type ErrorLike =
  | Error
  | {
      message?: string
      response?: {
        data?: ErrorResponseData
      }
    }

type StructuredOutputProfileMetadata = {
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

const toErrorLike = (
  value: object | string | number | boolean | null | undefined
): ErrorLike => {
  if (value instanceof Error) return value
  if (value && typeof value === 'object') {
    return value as Extract<ErrorLike, object>
  }
  return {
    message: String(value || 'unknown structured output error')
  }
}

const getErrorText = (error: ErrorLike): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  return 'unknown structured output error'
}

const getStructuredOutputErrorBody = (error: ErrorLike): string => {
  const parts = [getErrorText(error)]
  const responseData =
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'data' in error.response
      ? error.response.data
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

export const isStructuredOutputTransportCompatibilityError = (
  transport: AiStructuredOutputTransport,
  error: ErrorLike
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

export const isStructuredOutputMethodUnsupportedError = (
  method: NativeStructuredOutputMethod,
  error: ErrorLike
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

const buildMethodConfig = (method: NativeStructuredOutputMethod, schemaName: string) => {
  if (method === 'jsonMode') {
    return {
      method,
      name: schemaName
    } as const
  }

  return {
    method,
    name: schemaName,
    strict: true
  } as const
}

const extractTextContent = (content: unknown): string => {
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

const normalizePromptJsonText = (raw: string): string => {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

const parsePromptJsonOutput = (raw: string): Record<string, unknown> => {
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

const buildStructuredOutputProfile = (
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

const resolveStructuredOutputProfile = (
  profile: PreferredStructuredOutputProfile
): StructuredOutputProfileMetadata => STRUCTURED_OUTPUT_PROFILE_METADATA[profile]

const resolveResultProfile = (
  result: StructuredOutputDriverResult
): AiStructuredOutputProfile => {
  if (result.profile) {
    return result.profile
  }

  if (result.method === 'scripted') {
    return 'scripted'
  }

  if (result.transport) {
    return buildStructuredOutputProfile(result.transport, result.method)
  }

  throw new Error('structured_output_driver_missing_profile')
}

const invokeStructuredChatWithPromptJsonDriver = async <T extends Record<string, unknown>>(
  input: StructuredOutputInvocationInput<T>,
  transport: AiStructuredOutputTransport
): Promise<StructuredOutputDriverResult> => {
  const model = createChatModel(input.cfg, {
    temperature: input.temperature ?? 0.2,
    transport
  })
  const response = await model.invoke([
    new SystemMessage(input.system),
    new HumanMessage(input.user)
  ])
  const rawText = extractTextContent(response.content)
  return {
    output: parsePromptJsonOutput(rawText),
    method: 'promptJson',
    transport,
    profile: buildStructuredOutputProfile(transport, 'promptJson')
  }
}

const buildAttemptOrder = (
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

const getTransportBoundaryIndex = (
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

const buildStructuredOutputFailure = (input: {
  caller: string
  schemaName: string
  modelName: string
  profile: PreferredStructuredOutputProfile
  transport: AiStructuredOutputTransport
  method: NonScriptedStructuredOutputMethod
  reason: string
}) =>
  new Error(
    [
      'structured_output_failed',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.modelName}`,
      `profile=${input.profile}`,
      `transport=${input.transport}`,
      `method=${input.method}`,
      `reason=${input.reason}`
    ].join('; ')
  )

const invokeStructuredChatWithProfile = async <T extends Record<string, unknown>>(
  profile: PreferredStructuredOutputProfile,
  input: StructuredOutputInvocationInput<T>
): Promise<StructuredOutputDriverResult> => {
  const { method, transport } = resolveStructuredOutputProfile(profile)

  if (method === 'promptJson') {
    return await invokeStructuredChatWithPromptJsonDriver(input, transport)
  }

  const model = createChatModel(input.cfg, {
    temperature: input.temperature ?? 0.2,
    transport
  })
  const structuredModel = model.withStructuredOutput(input.schema, buildMethodConfig(method, input.schemaName))
  return {
    output: await structuredModel.invoke([
      new SystemMessage(input.system),
      new HumanMessage(input.user)
    ]),
    method,
    transport,
    profile
  }
}

const invokeStructuredChatWithNativeDriver = async <T extends Record<string, unknown>>(
  input: StructuredOutputInvocationInput<T>
): Promise<StructuredOutputDriverResult> => {
  const attemptOrder = buildAttemptOrder(input.preferredProfile)
  const attemptedProfiles: PreferredStructuredOutputProfile[] = []
  const profileErrors: string[] = []

  for (let index = 0; index < attemptOrder.length; index += 1) {
    const profile = attemptOrder[index]
    const { method, transport } = resolveStructuredOutputProfile(profile)
    attemptedProfiles.push(profile)
    try {
      const result = await invokeStructuredChatWithProfile(profile, input)
      return {
        ...result,
        fallbackChain: attemptedProfiles
      }
    } catch (error) {
      const normalizedError = toErrorLike(
        error as object | string | number | boolean | null | undefined
      )
      const reason = getErrorText(normalizedError)
      if (isStructuredOutputTransportCompatibilityError(transport, normalizedError)) {
        profileErrors.push(`${profile}: ${reason}`)
        index = getTransportBoundaryIndex(attemptOrder, index)
        continue
      }
      if (method !== 'promptJson' && isStructuredOutputMethodUnsupportedError(method, normalizedError)) {
        profileErrors.push(`${profile}: ${reason}`)
        continue
      }
      throw buildStructuredOutputFailure({
        caller: input.caller,
        schemaName: input.schemaName,
        modelName: input.cfg.model_name,
        profile,
        transport,
        method,
        reason
      })
    }
  }

  throw new Error(
    [
      'structured_output_unsupported',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.cfg.model_name}`,
      `tried=${attemptedProfiles.join(' -> ')}`,
      `errors=${profileErrors.join(' | ') || 'unknown'}`
    ].join('; ')
  )
}

export const invokeStructuredChat = async <T extends Record<string, unknown>>(
  input: StructuredOutputInvocationInput<T> & {
    driver?: StructuredOutputDriver
  }
): Promise<StructuredOutputInvocationResult<T>> => {
  const driver = input.driver || invokeStructuredChatWithNativeDriver
  const result = await driver(input as StructuredOutputInvocationInput<Record<string, unknown>>)
  const profile = resolveResultProfile(result)
  const fallbackChain =
    result.fallbackChain && result.fallbackChain.length > 0 ? result.fallbackChain : [profile]

  return {
    output: input.schema.parse(result.output),
    method: result.method,
    transport: result.transport,
    profile,
    fallbackChain
  }
}
