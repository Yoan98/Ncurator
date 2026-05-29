import type { JsonValue } from '../../../../../../shared/types'
import { HUMAN_TOOL_RESULT_TOKEN_LIMIT_RATIO } from '../../constants'
import { estimateTextTokens } from '../../utils/tokenEstimate'

export const estimateToolResultTokens = (value: JsonValue | string): number => {
  if (typeof value === 'string') return estimateTextTokens(value)
  return estimateTextTokens(JSON.stringify(value))
}

export const getAiResultTokenLimit = (input: {
  modelContextWindowTokens?: number
  ratio?: number
}): number => {
  const contextWindowTokens = Math.max(1, Number(input.modelContextWindowTokens || 200_000))
  const ratio = Math.max(0.01, Number(input.ratio || HUMAN_TOOL_RESULT_TOKEN_LIMIT_RATIO))
  return Math.max(1, Math.floor(contextWindowTokens * ratio))
}
