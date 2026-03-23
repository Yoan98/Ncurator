import { isJsonObject } from '../../../../utils/aiCapabilityUtils'
import type { JsonValue } from '../../../../../shared/types'
import { TOOL_CALL_RESULT_CODES } from '../constants'
import type { ToolCallResult, ToolCallResultCode } from '../types'

export const isToolCallResultCode = (value: string): value is ToolCallResultCode =>
  TOOL_CALL_RESULT_CODES.includes(value as ToolCallResultCode)

export const parseToolCallResultCode = (input: {
  code?: JsonValue
  ok?: boolean
  success?: boolean
}): ToolCallResultCode => {
  const { code, ok, success } = input
  if (typeof code === 'string' && isToolCallResultCode(code)) {
    return code
  }

  return ok === false || success === false ? 'failed' : 'ok'
}

export const normalizeToolCallResult = (
  toolName: string,
  payload: JsonValue
): ToolCallResult => {
  if (isJsonObject(payload)) {
    return {
      toolName,
      ok: payload.ok !== false && payload.success !== false,
      code: parseToolCallResultCode({
        code: payload.code,
        ok: payload.ok === false ? false : payload.ok === true ? true : undefined,
        success: payload.success === false ? false : payload.success === true ? true : undefined
      }),
      summary:
        typeof payload.summary === 'string'
          ? payload.summary
          : typeof payload.error === 'string'
            ? payload.error
            : typeof payload.message === 'string'
              ? payload.message
              : `${toolName} executed`,
      data: payload
    }
  }

  if (typeof payload === 'string') {
    return {
      toolName,
      ok: true,
      code: 'ok',
      summary: payload.trim() || `${toolName} executed`,
      data: payload
    }
  }

  if (Array.isArray(payload)) {
    return {
      toolName,
      ok: true,
      code: 'ok',
      summary: `${toolName} returned ${payload.length} item(s)`,
      data: payload
    }
  }

  return {
    toolName,
    ok: true,
    code: 'ok',
    summary: `${toolName} executed`,
    data: payload
  }
}
