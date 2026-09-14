import type { AiRunFailureCode } from '../../../../shared/types'
import type { HumanState } from '../human/types'
import {
  findLlmProviderError,
  isLlmInputTooLongError,
  isLlmOutputTruncatedError
} from '../errors'
import { normalizeStructuredOutputError } from '../structuredOutput'
import { resolveAiRunFailurePresentation } from '../runFailureCatalog'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'unknown')

export const isContentSafetyError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase()
  let raw = ''
  if (error && typeof error === 'object') {
    try {
      raw = JSON.stringify(error).toLowerCase()
    } catch {
      raw = ''
    }
  }
  const text = `${message} ${raw}`
  return (
    text.includes('inappropriate-content') ||
    text.includes('content_policy_violation') ||
    text.includes('content_filter') ||
    text.includes('content safety') ||
    text.includes('内容安全')
  )
}

export const isCancelledError = (error: unknown): boolean => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const name =
    error && typeof error === 'object' && 'name' in error ? String(error.name || '') : ''
  const message = getErrorMessage(error).toLowerCase()
  return (
    code === 'CANCELLED' ||
    name === 'AbortError' ||
    name === 'ModelAbortError' ||
    message.includes('cancel') ||
    message.includes('aborted')
  )
}

export const isGraphRuntimeLimitError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    (('lc_error_code' in error && error.lc_error_code === 'GRAPH_RECURSION_LIMIT') ||
      ('name' in error && error.name === 'GraphRecursionError'))
  )

export type AiRunFailure = Error & {
  name: 'AiRunFailure'
  code: 'AI_RUN_FAILURE'
  failureCode: AiRunFailureCode
  rawMessage?: string
  httpStatus?: number
  providerCode?: string
  lastHumanState?: HumanState
}

export const isAiRunFailure = (error: unknown): error is AiRunFailure =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AiRunFailure' &&
    'code' in error &&
    error.code === 'AI_RUN_FAILURE' &&
    'failureCode' in error
  )

export const createAiRunFailure = (input: {
  failureCode: AiRunFailureCode
  cause?: unknown
  rawMessage?: string
  httpStatus?: number
  providerCode?: string
  lastHumanState?: HumanState
}): AiRunFailure => {
  const presentation = resolveAiRunFailurePresentation(input.failureCode, input.rawMessage)
  const causeError =
    input.cause instanceof Error
      ? input.cause
      : input.cause !== undefined
        ? new Error(String(input.cause))
        : undefined
  const error = new Error(presentation.message, {
    cause: causeError
  }) as AiRunFailure
  error.name = 'AiRunFailure'
  error.code = 'AI_RUN_FAILURE'
  error.failureCode = input.failureCode
  error.rawMessage = presentation.rawMessage
  error.httpStatus = input.httpStatus
  error.providerCode = input.providerCode
  error.lastHumanState = input.lastHumanState
  return error
}

const resolveProviderRawMessage = (error: unknown): string | undefined => {
  const providerError = findLlmProviderError(error)
  if (providerError?.message.trim()) return providerError.message.trim()
  const info = normalizeStructuredOutputError(error)
  if (info.hasProviderSignal && info.message.trim()) return info.message.trim()
  const message = getErrorMessage(error).trim()
  return message || undefined
}

export const classifyThrownErrorToAiRunFailure = (
  error: unknown,
  lastHumanState?: HumanState
): AiRunFailure => {
  if (isAiRunFailure(error)) {
    if (lastHumanState && !error.lastHumanState) {
      error.lastHumanState = lastHumanState
    }
    return error
  }

  if (isCancelledError(error)) {
    return createAiRunFailure({
      failureCode: 'user_cancelled',
      cause: error,
      lastHumanState
    })
  }

  if (isGraphRuntimeLimitError(error)) {
    return createAiRunFailure({
      failureCode: 'runtime_limit',
      cause: error,
      rawMessage: getErrorMessage(error),
      lastHumanState
    })
  }

  if (isLlmOutputTruncatedError(error)) {
    return createAiRunFailure({
      failureCode: 'output_truncated',
      cause: error,
      rawMessage: error.message,
      lastHumanState
    })
  }

  if (isLlmInputTooLongError(error)) {
    return createAiRunFailure({
      failureCode: 'input_too_long',
      cause: error,
      lastHumanState
    })
  }

  const providerError = findLlmProviderError(error)
  const info = normalizeStructuredOutputError(error)
  if (providerError || info.hasProviderSignal) {
    return createAiRunFailure({
      failureCode: 'llm_request_failed',
      cause: error,
      rawMessage: resolveProviderRawMessage(error),
      httpStatus: providerError?.httpStatus ?? info.status,
      providerCode: providerError?.providerCode ?? info.code,
      lastHumanState
    })
  }

  return createAiRunFailure({
    failureCode: 'unexpected_error',
    cause: error,
    rawMessage: getErrorMessage(error),
    lastHumanState
  })
}
