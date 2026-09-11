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
  TOOL_RESULT_REJECT_MAX_BYTES,
  TOOL_RESULT_REJECT_MAX_LINES,
  TOOL_RESULT_SPILL_MAX_CHARS,
  TOOL_RESULT_TAIL_MAX_CHARS
} from './toolResultPersistence'

export type ModelToolResultDelivery = {
  content: string
  ok: boolean
}

export const exceedsToolResultRejectLimit = (input: {
  totalBytes: number
  totalLines: number
}): boolean =>
  input.totalBytes > TOOL_RESULT_REJECT_MAX_BYTES || input.totalLines > TOOL_RESULT_REJECT_MAX_LINES

const buildOversizeRejectMessage = (input: {
  toolName: string
  totalBytes: number
  totalLines: number
}): string =>
  [
    `Error: The result from ${input.toolName} is too large`,
    `(${input.totalBytes.toLocaleString('en-US')} UTF-8 bytes; limit: ${TOOL_RESULT_REJECT_MAX_BYTES.toLocaleString('en-US')} bytes; ${input.totalLines.toLocaleString('en-US')} lines; limit: ${TOOL_RESULT_REJECT_MAX_LINES.toLocaleString('en-US')} lines).`,
    'Narrow the tool arguments and try again.'
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

  if (input.result.ok) {
    const totalBytes = countUtf8Bytes(content)
    const totalLines = countPhysicalLines(content)
    if (exceedsToolResultRejectLimit({ totalBytes, totalLines })) {
      return {
        content: buildOversizeRejectMessage({
          toolName: input.result.toolName,
          totalBytes,
          totalLines
        }),
        ok: false
      }
    }

    const totalChars = countUnicodeCharacters(content)
    if (totalChars > TOOL_RESULT_SPILL_MAX_CHARS) {
      const persisted = await persistToolResult({
        ctx: input.ctx,
        toolCallId: input.toolCallId,
        content
      })
      if (persisted) {
        return {
          content: buildTruncatedToolResultMessage({
            filePath: persisted.filePath,
            head: sliceUnicodeCharacters(content, TOOL_RESULT_HEAD_MAX_CHARS),
            tail: sliceUnicodeCharactersFromEnd(content, TOOL_RESULT_TAIL_MAX_CHARS),
            totalChars,
            totalBytes,
            totalLines
          }),
          ok: true
        }
      }
    }
  }

  return { content, ok: input.result.ok }
}
