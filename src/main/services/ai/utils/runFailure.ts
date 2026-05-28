import type { AiRunFailureCode } from '../../../../shared/types'
import type { HumanState } from '../human/types'
import type { RecoverableHumanRunError, RecoverableRunErrorCode } from '../types'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'unknown')

export const isCancelledError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED')

export const classifyLlmFailureCode = (error: unknown): AiRunFailureCode => {
  const message = getErrorMessage(error).toLowerCase()
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code || '').toLowerCase() : ''
  const name =
    error && typeof error === 'object' && 'name' in error ? String(error.name || '').toLowerCase() : ''

  if (
    code === 'timeout' ||
    code === 'aborterror' ||
    name === 'aborterror' ||
    message.includes('abort') ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return 'timeout'
  }

  if (
    code === 'econnreset' ||
    code === 'econnrefused' ||
    code === 'enotfound' ||
    code === 'eai_again' ||
    code === 'etimedout' ||
    code === 'fetch_error' ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('econn') ||
    message.includes('dns')
  ) {
    return 'network_error'
  }

  return 'error'
}

export const isRecoverableRunErrorCode = (
  code: AiRunFailureCode
): code is RecoverableRunErrorCode => code === 'timeout' || code === 'network_error'

export const createRecoverableHumanRunError = (input: {
  reason: RecoverableRunErrorCode
  error: unknown
  lastHumanState?: HumanState
}): RecoverableHumanRunError => {
  const baseError =
    input.error instanceof Error ? input.error : new Error(String(input.error || input.reason))
  const error = new Error(baseError.message) as RecoverableHumanRunError
  error.name = 'RecoverableHumanRunError'
  error.code = 'RECOVERABLE_HUMAN_RUN'
  error.reason = input.reason
  error.lastHumanState = input.lastHumanState
  error.cause = baseError
  return error
}

export const isRecoverableHumanRunError = (error: unknown): error is RecoverableHumanRunError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'RECOVERABLE_HUMAN_RUN' &&
      'reason' in error &&
      (error.reason === 'timeout' || error.reason === 'network_error')
  )
