import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod/v4'
import { createChatModel } from '../llm/chatModel'
import type { LLMConfig, PreferredStructuredOutputMethod } from '../../../shared/types'

export const NATIVE_STRUCTURED_OUTPUT_METHODS = ['jsonSchema', 'jsonMode'] as const
export const STRUCTURED_OUTPUT_METHODS = [...NATIVE_STRUCTURED_OUTPUT_METHODS, 'promptJson'] as const

export type NativeStructuredOutputMethod = (typeof NATIVE_STRUCTURED_OUTPUT_METHODS)[number]
export type StructuredOutputMethod = PreferredStructuredOutputMethod | 'scripted'

export type StructuredOutputInvocationResult<T extends Record<string, unknown>> = {
  output: T
  method: StructuredOutputMethod
  fallbackChain: StructuredOutputMethod[]
}

type StructuredOutputInvocationInput<T extends Record<string, unknown>> = {
  caller: string
  cfg: LLMConfig
  preferredMethod?: PreferredStructuredOutputMethod
  schema: z.ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
}

export type StructuredOutputDriverResult = {
  output: unknown
  method: StructuredOutputMethod
  fallbackChain?: StructuredOutputMethod[]
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

export const isStructuredOutputMethodUnsupportedError = (
  method: NativeStructuredOutputMethod,
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

  return matchesUnsupportedSignal(body, ['json mode', 'json_object', 'response_format', 'response format'])
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

const invokeStructuredChatWithPromptJsonDriver = async <T extends Record<string, unknown>>(
  input: StructuredOutputInvocationInput<T>
): Promise<StructuredOutputDriverResult> => {
  const model = createChatModel(input.cfg, { temperature: input.temperature ?? 0.2 })
  const response = await model.invoke([
    new SystemMessage(input.system),
    new HumanMessage(input.user)
  ])
  const rawText = extractTextContent(response.content)
  return {
    output: parsePromptJsonOutput(rawText),
    method: 'promptJson'
  }
}

const buildAttemptOrder = (
  preferredMethod?: PreferredStructuredOutputMethod
): PreferredStructuredOutputMethod[] => {
  if (!preferredMethod) {
    return [...STRUCTURED_OUTPUT_METHODS]
  }
  return [
    preferredMethod,
    ...STRUCTURED_OUTPUT_METHODS.filter((method) => method !== preferredMethod)
  ]
}

const buildStructuredOutputFailure = (input: {
  caller: string
  schemaName: string
  modelName: string
  method: PreferredStructuredOutputMethod
  reason: string
}) =>
  new Error(
    [
      'structured_output_failed',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.modelName}`,
      `method=${input.method}`,
      `reason=${input.reason}`
    ].join('; ')
  )

const invokeStructuredChatWithMethod = async <T extends Record<string, unknown>>(
  method: PreferredStructuredOutputMethod,
  input: StructuredOutputInvocationInput<T>
): Promise<StructuredOutputDriverResult> => {
  if (method === 'promptJson') {
    return await invokeStructuredChatWithPromptJsonDriver(input)
  }

  const model = createChatModel(input.cfg, { temperature: input.temperature ?? 0.2 })
  const structuredModel = model.withStructuredOutput(input.schema, buildMethodConfig(method, input.schemaName))
  return {
    output: await structuredModel.invoke([
      new SystemMessage(input.system),
      new HumanMessage(input.user)
    ]),
    method
  }
}

const invokeStructuredChatWithNativeDriver = async <T extends Record<string, unknown>>(
  input: StructuredOutputInvocationInput<T>
): Promise<StructuredOutputDriverResult> => {
  const attemptOrder = buildAttemptOrder(input.preferredMethod)
  const methodErrors: string[] = []

  for (let index = 0; index < attemptOrder.length; index += 1) {
    const method = attemptOrder[index]
    try {
      const result = await invokeStructuredChatWithMethod(method, input)
      return {
        ...result,
        fallbackChain: attemptOrder.slice(0, index + 1)
      }
    } catch (error) {
      const normalizedError = toErrorLike(
        error as object | string | number | boolean | null | undefined
      )
      if (
        method !== 'promptJson' &&
        isStructuredOutputMethodUnsupportedError(method, normalizedError)
      ) {
        methodErrors.push(`${method}: ${getErrorText(normalizedError)}`)
        continue
      }
      throw buildStructuredOutputFailure({
        caller: input.caller,
        schemaName: input.schemaName,
        modelName: input.cfg.model_name,
        method,
        reason: getErrorText(normalizedError)
      })
    }
  }

  throw new Error(
    [
      'structured_output_unsupported',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.cfg.model_name}`,
      `tried=${attemptOrder.join(' -> ')}`,
      `errors=${methodErrors.join(' | ') || 'unknown'}`
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
  const fallbackChain =
    result.fallbackChain && result.fallbackChain.length > 0
      ? result.fallbackChain
      : [result.method]

  return {
    output: input.schema.parse(result.output),
    method: result.method,
    fallbackChain
  }
}
