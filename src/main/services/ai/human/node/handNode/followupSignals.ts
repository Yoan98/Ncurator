import type { JsonObject } from '../../../../../../shared/types'
import type { HandCallList, HumanDecisionHint, ToolCallResult } from '../../types'
import { isDocxPositionedLayoutProtectionMessage } from '../../tools/docx/constants'
import { deriveGroupedHandFailureHints } from './decisionHints'

const DOCX_WRITE_TOOL_NAMES = new Set([
  'docx_create',
  'docx_paragraph_edit',
  'docx_heading_edit',
  'docx_table_edit',
  'docx_text_edit',
  'docx_text_style_edit',
  'docx_delete'
])

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const describeSourcePath = (sourcePath: string | undefined): string | undefined => {
  const normalized = asString(sourcePath)
  return normalized ? `在 ${normalized} 中，` : undefined
}

const describePositionedTarget = (toolName: string, args: JsonObject | undefined): string => {
  const sourcePathPrefix = describeSourcePath(asString(args?.sourcePath))
  switch (toolName) {
    case 'docx_paragraph_edit': {
      const action = asString(args?.action)
      if (action === 'insert_before' || action === 'insert_after') {
        return `${sourcePathPrefix || ''}你刚才尝试插入新段落的那处位置`
      }
      if (action === 'delete') {
        return `${sourcePathPrefix || ''}你刚才尝试删除段落的那处位置`
      }
      return `${sourcePathPrefix || ''}你刚才尝试修改段落的那处位置`
    }
    case 'docx_heading_edit': {
      const action = asString(args?.action)
      return action === 'insert_before' || action === 'insert_after'
        ? `${sourcePathPrefix || ''}你刚才尝试插入标题的那处位置`
        : `${sourcePathPrefix || ''}你刚才尝试修改标题的那处位置`
    }
    case 'docx_table_edit': {
      const action = asString(args?.action)
      return action === 'update_cell'
        ? `${sourcePathPrefix || ''}你刚才尝试修改表格单元格的那处位置`
        : `${sourcePathPrefix || ''}你刚才尝试插入表格的那处位置`
    }
    case 'docx_text_edit':
      return Array.isArray(args?.blockIds) && args.blockIds.length > 0
        ? `${sourcePathPrefix || ''}你刚才尝试替换命中文本的那处区域`
        : `${sourcePathPrefix || ''}你刚才尝试批量替换文本的那处区域`
    case 'docx_text_style_edit':
      return `${sourcePathPrefix || ''}你刚才尝试调整文本样式的那处区域`
    case 'docx_delete':
      return `${sourcePathPrefix || ''}你刚才尝试删除完整 block 的那处区域`
    default:
      return `${sourcePathPrefix || ''}你刚才尝试修改的那处目标区域`
  }
}

const buildPositionedWriteBlockedSignals = (input: {
  toolName: string
  args?: JsonObject
}): {
  decisionHint: Extract<HumanDecisionHint, { code: 'hand_docx_positioned_write_blocked' }>
  deliveryGuidance: string
} => {
  const targetDescription = describePositionedTarget(input.toolName, input.args)
  const sourcePath = asString(input.args?.sourcePath)
  return {
    decisionHint: {
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        targetDescription,
        sourcePath
      }
    },
    deliveryGuidance: `${targetDescription}命中了排版保护。按系统设计，这类定位区域不会被自动修改。本轮这处位置没有被自动修改，也没有生成对应的审阅稿。最终答复中需要明确说明这一事实。`
  }
}

export const deriveHandFollowupSignals = (input: {
  calls: HandCallList
  results: readonly ToolCallResult[]
}): {
  decisionHint?: HumanDecisionHint
  deliveryGuidance?: string
} => {
  const groupedFailureHints = deriveGroupedHandFailureHints(input)

  for (const [index, result] of input.results.entries()) {
    const toolResultHint = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? (result.data as { decisionHint?: HumanDecisionHint }).decisionHint
      : undefined
    if (toolResultHint?.code === 'hand_tool_result_too_large') {
      return {
        decisionHint: toolResultHint
      }
    }

    if (!DOCX_WRITE_TOOL_NAMES.has(result.toolName) || result.ok) continue
    if (!isDocxPositionedLayoutProtectionMessage(result.diagnostic?.message)) continue

    const plannedCall = input.calls[index]
    return buildPositionedWriteBlockedSignals({
      toolName: result.toolName,
      args: plannedCall?.args
    })
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
  ['hand_tool_result_too_large', 'hand_docx_positioned_write_blocked'].includes(
    deriveHandFollowupSignals(input).decisionHint?.code || ''
  )
