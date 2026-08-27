import type { ModelResultOverflowPolicy } from './types'

export const MODEL_RESULT_RETRY_MAX_BYTES = 51_200
export const MODEL_RESULT_RETRY_MAX_LINES = 2_000

export const createRetryModelResultPolicy = (retryHint: string): ModelResultOverflowPolicy => ({
  mode: 'retry',
  maxBytes: MODEL_RESULT_RETRY_MAX_BYTES,
  maxLines: MODEL_RESULT_RETRY_MAX_LINES,
  retryHint
})
