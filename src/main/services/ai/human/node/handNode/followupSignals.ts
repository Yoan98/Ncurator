import type { JsonObject } from '../../../../../../shared/types'
import type { HumanWatchHint, ToolCallResult, ToolUsePlan } from '../../types'
import { isDocxPositionedLayoutProtectionMessage } from '../../tools/docx/constants'

const DOCX_WRITE_TOOL_NAMES = new Set([
  'docx_create',
  'docx_paragraph_edit',
  'docx_heading_edit',
  'docx_table_edit',
  'docx_text_edit',
  'docx_text_style_edit'
])

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const describePositionedTarget = (toolName: string, args: JsonObject | undefined): string => {
  switch (toolName) {
    case 'docx_paragraph_edit': {
      const action = asString(args?.action)
      if (action === 'insert_before' || action === 'insert_after') {
        return '你刚才尝试插入新段落的那处位置'
      }
      if (action === 'delete') {
        return '你刚才尝试删除段落的那处位置'
      }
      return '你刚才尝试修改段落的那处位置'
    }
    case 'docx_heading_edit': {
      const action = asString(args?.action)
      return action === 'insert_before' || action === 'insert_after'
        ? '你刚才尝试插入标题的那处位置'
        : '你刚才尝试修改标题的那处位置'
    }
    case 'docx_table_edit': {
      const action = asString(args?.action)
      return action === 'update_cell'
        ? '你刚才尝试修改表格单元格的那处位置'
        : '你刚才尝试插入表格的那处位置'
    }
    case 'docx_text_edit':
      return Array.isArray(args?.blockIds) && args.blockIds.length > 0
        ? '你刚才尝试替换命中文本的那处区域'
        : '你刚才尝试批量替换文本的那处区域'
    case 'docx_text_style_edit':
      return '你刚才尝试调整文本样式的那处区域'
    default:
      return '你刚才尝试修改的那处目标区域'
  }
}

const buildPositionedWriteBlockedSignals = (input: {
  toolName: string
  args?: JsonObject
}): {
  watchHint: Extract<HumanWatchHint, { code: 'hand_docx_positioned_write_blocked' }>
  deliveryGuidance: string
} => {
  const targetDescription = describePositionedTarget(input.toolName, input.args)
  return {
    watchHint: {
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        targetDescription
      }
    },
    deliveryGuidance: `${targetDescription}这次没有被自动修改，也没有生成对应的审阅稿。请在最终答复中先明确说明这一点，再给出用户可以手动补充的建议内容。`
  }
}

export const deriveHandFollowupSignals = (input: {
  toolUsePlan: ToolUsePlan
  results: readonly ToolCallResult[]
}): {
  watchHint?: HumanWatchHint
  deliveryGuidance?: string
} => {
  for (const [index, result] of input.results.entries()) {
    if (!DOCX_WRITE_TOOL_NAMES.has(result.toolName) || result.ok) continue
    const haltedHint = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? (result.data as { watchHint?: HumanWatchHint }).watchHint
      : undefined
    if (haltedHint?.code === 'hand_docx_batch_write_halted') {
      return {
        watchHint: haltedHint
      }
    }
    if (!isDocxPositionedLayoutProtectionMessage(result.diagnostic?.message)) continue

    const plannedCall = input.toolUsePlan.calls[index]
    return buildPositionedWriteBlockedSignals({
      toolName: result.toolName,
      args: plannedCall?.args
    })
  }

  const docxWriteResults = input.results.filter((result) => DOCX_WRITE_TOOL_NAMES.has(result.toolName))
  if (docxWriteResults.length > 0) {
    const sourcePaths = [...new Set(
      docxWriteResults
        .map((result) => result.resourceContext?.sourcePath)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )]
    const latestRevisionRefs = [...new Set(
      docxWriteResults
        .map((result) => result.resourceContext?.currentRevisionRef)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )]
    return {
      watchHint: {
        code: 'docx_write_requires_readback',
        detail: {
          sourcePaths,
          latestRevisionRefs
        }
      }
    }
  }

  return {}
}

export const shouldStopSerialHandPlan = (input: {
  toolUsePlan: ToolUsePlan
  results: readonly ToolCallResult[]
}): boolean =>
  ['hand_docx_positioned_write_blocked', 'hand_docx_batch_write_halted'].includes(
    deriveHandFollowupSignals(input).watchHint?.code || ''
  )
