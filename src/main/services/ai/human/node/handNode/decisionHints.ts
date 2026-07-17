import type { HandCallList, HumanDecisionHint, ToolCallResult } from '../../types'
import { resolveToolResultErrorText } from '../../shared/toolResultRenderers'

type IndexedResult = {
  callIndex: number
  toolName: string
  message: string
}

const WORKSPACE_BOUNDARY_PATTERNS = [
  'workspace boundary check failed:',
  'relative path escapes workspace boundary:',
  'path out of workspace boundary:',
  'cwd is out of workspace boundary'
] as const

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

export const buildHandWorkspaceBoundaryBlockedHint = (
  items: IndexedResult[]
): Extract<HumanDecisionHint, { code: 'hand_workspace_boundary_blocked' }> => ({
  code: 'hand_workspace_boundary_blocked',
  detail: {
    blockedCalls: items
  }
})

export const deriveGroupedHandFailureHints = (input: {
  calls: HandCallList
  results: readonly ToolCallResult[]
}): {
  callInvalidHint?: Extract<HumanDecisionHint, { code: 'hand_call_invalid' }>
  workspaceBoundaryHint?: Extract<HumanDecisionHint, { code: 'hand_workspace_boundary_blocked' }>
} => {
  const invalidCalls: IndexedResult[] = []
  const blockedCalls: IndexedResult[] = []
  input.results.forEach((result, callIndex) => {
    if (result.ok) return
    const message = resolveToolResultErrorText(result)
    if (!message) return

    if (hasPattern(message, WORKSPACE_BOUNDARY_PATTERNS)) {
      blockedCalls.push(buildIndexedResult({ callIndex, result, message }))
      return
    }

    if (hasPattern(message, INVALID_INPUT_PATTERNS)) {
      invalidCalls.push(buildIndexedResult({ callIndex, result, message }))
      return
    }

  })

  return {
    callInvalidHint: invalidCalls.length > 0 ? buildHandCallInvalidHint(invalidCalls) : undefined,
    workspaceBoundaryHint:
      blockedCalls.length > 0 ? buildHandWorkspaceBoundaryBlockedHint(blockedCalls) : undefined
  }
}
