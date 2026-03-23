import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod/v4'
import { createChatModel } from '../llm/chatModel'
import type { LLMConfig } from '../../../shared/types'

const STRUCTURED_OUTPUT_METHODS = ['jsonSchema', 'functionCalling', 'jsonMode'] as const

type StructuredOutputMethod = (typeof STRUCTURED_OUTPUT_METHODS)[number]

type StructuredOutputInvocationInput<T extends Record<string, unknown>> = {
  caller: string
  cfg: LLMConfig
  schema: z.ZodType<T>
  schemaName: string
  system: string
  user: string
  temperature?: number
}

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
  method: StructuredOutputMethod,
  error: ErrorLike
): boolean => {
  const body = getStructuredOutputErrorBody(error).toLowerCase()
  if (!body) return false

  if (method === 'jsonSchema') {
    return matchesUnsupportedSignal(body, [
      'json schema',
      'json_schema',
      'response_format',
      'response format'
    ])
  }

  if (method === 'functionCalling') {
    return matchesUnsupportedSignal(body, [
      'function calling',
      'function_calling',
      'tool calling',
      'tools',
      'tool_choice',
      'tool choice'
    ])
  }

  return matchesUnsupportedSignal(body, ['json mode', 'json_object', 'response_format', 'response format'])
}

const buildMethodConfig = (method: StructuredOutputMethod, schemaName: string) => {
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

export const invokeStructuredChat = async <T extends Record<string, unknown>>(
  input: StructuredOutputInvocationInput<T>
): Promise<T> => {
  const methodErrors: string[] = []

  for (const method of STRUCTURED_OUTPUT_METHODS) {
    try {
      const model = createChatModel(input.cfg, { temperature: input.temperature ?? 0.2 })
      const structuredModel = model.withStructuredOutput(
        input.schema,
        buildMethodConfig(method, input.schemaName)
      )
      return (await structuredModel.invoke([
        new SystemMessage(input.system),
        new HumanMessage(input.user)
      ])) as T
    } catch (error) {
      const normalizedError = toErrorLike(
        error as object | string | number | boolean | null | undefined
      )
      if (isStructuredOutputMethodUnsupportedError(method, normalizedError)) {
        methodErrors.push(`${method}: ${getErrorText(normalizedError)}`)
        continue
      }
      throw new Error(
        [
          'structured_output_failed',
          `caller=${input.caller}`,
          `schema=${input.schemaName}`,
          `model=${input.cfg.model_name}`,
          `method=${method}`,
          `reason=${getErrorText(normalizedError)}`
        ].join('; ')
      )
    }
  }

  throw new Error(
    [
      'structured_output_unsupported',
      `caller=${input.caller}`,
      `schema=${input.schemaName}`,
      `model=${input.cfg.model_name}`,
      `tried=${STRUCTURED_OUTPUT_METHODS.join(' -> ')}`,
      `errors=${methodErrors.join(' | ') || 'unknown'}`
    ].join('; ')
  )
}
