import type { JsonObject } from '../../../../../../shared/types'
import type { HandCallList, HumanDecisionHint, ToolCallResult } from '../../types'
import { isDocxPositionedLayoutProtectionMessage } from '../../tools/docx/constants'
import { deriveGroupedHandFailureHints } from './decisionHints'

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const readDocxEditActionTypes = (args: JsonObject | undefined): string | undefined => {
  if (!Array.isArray(args?.actions)) return undefined
  const types = args.actions
    .map((action) =>
      action && typeof action === 'object' && !Array.isArray(action)
        ? asString((action as JsonObject).type)
        : undefined
    )
    .filter((type): type is string => Boolean(type))
  return types.length > 0 ? types.join(', ') : undefined
}

const readDocxEditFailureHint = (input: {
  call: HandCallList[number] | undefined
  result: ToolCallResult
}): Extract<
  HumanDecisionHint,
  { code: 'hand_docx_edit_failed' | 'hand_docx_positioned_write_blocked' }
> | undefined => {
  if (input.result.toolName !== 'docx_edit' || input.result.ok) return undefined
  const args = input.call?.args
  const data = input.result.data
  const dataError = data && typeof data === 'object' && !Array.isArray(data)
    ? asString((data as JsonObject).error)
    : undefined
  const diagnosticMessage = asString(input.result.diagnostic?.message)
  const error =
    dataError
    || diagnosticMessage
    || 'docx_edit failed'
  const diagnostic = diagnosticMessage && diagnosticMessage !== error ? diagnosticMessage : undefined
  if (isDocxPositionedLayoutProtectionMessage(error)) {
    const toolResultHint = data && typeof data === 'object' && !Array.isArray(data)
      ? (data as { decisionHint?: HumanDecisionHint }).decisionHint
      : undefined
    if (toolResultHint?.code === 'hand_docx_positioned_write_blocked') {
      return toolResultHint
    }
    return {
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: asString(args?.sourcePath),
        action: readDocxEditActionTypes(args),
        diagnostic: diagnostic || error
      }
    }
  }
  return {
    code: 'hand_docx_edit_failed',
    detail: {
      toolName: 'docx_edit',
      sourcePath: asString(args?.sourcePath),
      action: readDocxEditActionTypes(args),
      error,
      diagnostic
    }
  }
}

export const deriveHandFollowupSignals = (input: {
  calls: HandCallList
  results: readonly ToolCallResult[]
}): {
  decisionHint?: HumanDecisionHint
} => {
  const groupedFailureHints = deriveGroupedHandFailureHints(input)

  for (const [index, result] of input.results.entries()) {
    const toolResultHint = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? (result.data as { decisionHint?: HumanDecisionHint }).decisionHint
      : undefined
    if (
      toolResultHint?.code === 'hand_tool_result_too_large' ||
      toolResultHint?.code === 'hand_tool_result_unusable'
    ) {
      return {
        decisionHint: toolResultHint
      }
    }

    const docxEditFailureHint = readDocxEditFailureHint({
      call: input.calls[index],
      result
    })
    if (docxEditFailureHint) {
      return {
        decisionHint: docxEditFailureHint
      }
    }
  }

  return {
    decisionHint:
      groupedFailureHints.workspaceBoundaryHint
      || groupedFailureHints.callInvalidHint
      || groupedFailureHints.toolRuntimeFailedHint
  }
}

export const shouldStopSerialHandPlan = (input: {
  calls: HandCallList
  results: readonly ToolCallResult[]
}): boolean =>
  ['hand_tool_result_too_large', 'hand_tool_result_unusable'].includes(
    deriveHandFollowupSignals(input).decisionHint?.code || ''
  )
