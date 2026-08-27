import type { JsonObject } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { ToolCallResult } from '../types'
import { getToolSpec } from '../tools/registry'
import { renderGenericModelError, renderModelResultWith } from './modelToolResultRenderers'
import {
  buildTruncatedToolResultMessage,
  countPhysicalLines,
  countUnicodeCharacters,
  countUtf8Bytes,
  persistToolResult,
  sliceUnicodeCharacters,
  sliceUnicodeCharactersFromEnd,
  TOOL_RESULT_HEAD_MAX_CHARS,
  TOOL_RESULT_INLINE_MAX_CHARS,
  TOOL_RESULT_TAIL_MAX_CHARS
} from './toolResultPersistence'

export type ModelToolResultDelivery = {
  content: string
  ok: boolean
}

export const exceedsModelResultRetryLimit = (input: {
  totalBytes: number
  totalLines: number
  maxBytes: number
  maxLines: number
}): boolean => input.totalBytes > input.maxBytes || input.totalLines > input.maxLines

const buildOversizeRetryMessage = (input: {
  toolName: string
  totalBytes: number
  totalLines: number
  maxBytes: number
  maxLines: number
  retryHint: string
}): string =>
  [
    `Error: The result from ${input.toolName} is too large`,
    `(${input.totalBytes.toLocaleString('en-US')} UTF-8 bytes; limit: ${input.maxBytes.toLocaleString('en-US')} bytes; ${input.totalLines.toLocaleString('en-US')} lines; limit: ${input.maxLines.toLocaleString('en-US')} lines).`,
    input.retryHint
  ].join('\n')

export const buildModelToolResultDelivery = async (input: {
  ctx: AiRunContext
  toolCallId: string
  args: JsonObject
  result: ToolCallResult
}): Promise<ModelToolResultDelivery> => {
  const spec = getToolSpec(input.result.toolName, input.ctx.platform)
  const rendererInput = {
    toolName: input.result.toolName,
    args: input.args,
    data: input.result.data
  }
  const content = renderModelResultWith(
    input.result.ok
      ? spec?.modelResult?.renderSuccess
      : spec?.modelResult?.renderError || renderGenericModelError,
    rendererInput
  )
  const totalBytes = countUtf8Bytes(content)
  const totalLines = countPhysicalLines(content)
  const overflowPolicy = spec?.modelResult?.overflowPolicy || { mode: 'spill' as const }

  if (
    input.result.ok &&
    overflowPolicy.mode === 'retry' &&
    exceedsModelResultRetryLimit({
      totalBytes,
      totalLines,
      maxBytes: overflowPolicy.maxBytes,
      maxLines: overflowPolicy.maxLines
    })
  ) {
    return {
      content: buildOversizeRetryMessage({
        toolName: input.result.toolName,
        totalBytes,
        totalLines,
        maxBytes: overflowPolicy.maxBytes,
        maxLines: overflowPolicy.maxLines,
        retryHint: overflowPolicy.retryHint
      }),
      ok: false
    }
  }

  if (overflowPolicy.mode === 'window') {
    return { content, ok: input.result.ok }
  }

  const totalChars = countUnicodeCharacters(content)
  if (totalChars <= TOOL_RESULT_INLINE_MAX_CHARS) {
    return { content, ok: input.result.ok }
  }

  const persisted = await persistToolResult({
    ctx: input.ctx,
    toolCallId: input.toolCallId,
    content
  })
  if (!persisted) return { content, ok: input.result.ok }

  return {
    content: buildTruncatedToolResultMessage({
      filePath: persisted.filePath,
      head: sliceUnicodeCharacters(content, TOOL_RESULT_HEAD_MAX_CHARS),
      tail: sliceUnicodeCharactersFromEnd(content, TOOL_RESULT_TAIL_MAX_CHARS),
      totalChars,
      totalBytes,
      totalLines
    }),
    ok: input.result.ok
  }
}
