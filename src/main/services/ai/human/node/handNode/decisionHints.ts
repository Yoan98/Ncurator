import type { HandCallList, HumanDecisionHint, ToolCallResult } from '../../types'
import { resolveToolResultErrorText } from '../../shared/toolResultRenderers'

type IndexedResult = {
  callIndex: number
  toolName: string
  message: string
}

const INVALID_INPUT_PATTERNS = ['tool call schema invalid', 'invalid_input', 'empty command'] as const

const hasPattern = (value: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => value.includes(pattern))

const buildIndexedResult = (input: {
  callIndex: number
  result: ToolCallResult
  message: string
}): IndexedResult => ({
  callIndex: input.callIndex,
  toolName: input.result.toolName,
  message: input.message
})

export const buildHandCallInvalidHint = (items: IndexedResult[]): Extract<HumanDecisionHint, { code: 'hand_call_invalid' }> => ({
  code: 'hand_call_invalid',
  detail: {
    invalidCalls: items
  }
})

export const deriveGroupedHandFailureHints = (input: {
  calls: HandCallList
  results: readonly ToolCallResult[]
}): {
  callInvalidHint?: Extract<HumanDecisionHint, { code: 'hand_call_invalid' }>
} => {
  const invalidCalls: IndexedResult[] = []
  input.results.forEach((result, callIndex) => {
    if (result.ok) return
    const message = resolveToolResultErrorText(result)
    if (!message) return

    if (hasPattern(message, INVALID_INPUT_PATTERNS)) {
      invalidCalls.push(buildIndexedResult({ callIndex, result, message }))
      return
    }

  })

  return {
    callInvalidHint: invalidCalls.length > 0 ? buildHandCallInvalidHint(invalidCalls) : undefined
  }
}
