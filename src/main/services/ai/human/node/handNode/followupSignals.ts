import type { JsonObject } from '../../../../../../shared/types'
import type { HandCallList, HumanDecisionHint, ToolCallResult } from '../../types'
import { isDocxPositionedLayoutProtectionMessage } from '../../tools/docx/constants'
import { deriveGroupedHandFailureHints } from './decisionHints'

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const readLegacyDocEditUnsupportedHint = (
  data: ToolCallResult['data']
): Extract<HumanDecisionHint, { code: 'legacy_doc_edit_unsupported' }> | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const toolResultHint = (data as JsonObject).decisionHint
  if (!toolResultHint || typeof toolResultHint !== 'object' || Array.isArray(toolResultHint)) {
    return undefined
  }
  if (toolResultHint.code !== 'legacy_doc_edit_unsupported') return undefined
  const instruction = asString(toolResultHint.instruction)
  if (!instruction) return undefined
  return {
    code: 'legacy_doc_edit_unsupported',
    detail: { instruction }
  }
}

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
  const error = dataError || 'docx_edit failed'
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
        error
      }
    }
  }
  return {
    code: 'hand_docx_edit_failed',
    detail: {
      toolName: 'docx_edit',
      sourcePath: asString(args?.sourcePath),
      action: readDocxEditActionTypes(args),
      error
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
    const legacyDocEditUnsupportedHint = readLegacyDocEditUnsupportedHint(result.data)
    if (legacyDocEditUnsupportedHint) {
      return {
        decisionHint: legacyDocEditUnsupportedHint
      }
    }
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
    decisionHint: groupedFailureHints.callInvalidHint
  }
}

export const shouldStopSerialHandPlan = (input: {
  calls: HandCallList
  results: readonly ToolCallResult[]
}): boolean =>
  ['hand_tool_result_too_large', 'hand_tool_result_unusable'].includes(
    deriveHandFollowupSignals(input).decisionHint?.code || ''
  )
