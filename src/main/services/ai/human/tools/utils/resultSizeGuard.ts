import type { JsonValue } from '../../../../../shared/types'
import { estimateTextTokens } from '../../utils/tokenEstimate'

export const DEFAULT_TOOL_RESULT_TOKEN_LIMIT_RATIO = 0.1

export const estimateToolResultTokens = (value: JsonValue | string): number => {
  if (typeof value === 'string') return estimateTextTokens(value)
  return estimateTextTokens(JSON.stringify(value))
}

export const getAiResultTokenLimit = (input: {
  modelContextWindowTokens?: number
  ratio?: number
}): number => {
  const contextWindowTokens = Math.max(1, Number(input.modelContextWindowTokens || 200_000))
  const ratio = Math.max(0.01, Number(input.ratio || DEFAULT_TOOL_RESULT_TOKEN_LIMIT_RATIO))
  return Math.max(1, Math.floor(contextWindowTokens * ratio))
}
