import type { StructuredToolInterface } from '@langchain/core/tools'
import type { IpcJsonObject, JsonValue } from '../../../../../../shared/types'
import { isJsonObject } from '../../../../../utils/aiCapabilityUtils'
import { clipText } from '../../../utils/text'
import type { AiRunContext } from '../../../types'
import { TOOL_CALL_RESULT_CODES } from '../../constants'
import type {
  AiRunContextWithHumanOverrides,
  HumanRuntimeCache,
  RuntimeSkillId,
  ToolCallDiagnostic,
  ToolCallResult,
  ToolCallResultCode
} from '../../types'
import { withToolLifecycle } from '../../tools/utils/lifecycle'
import { createToolEventEmitter } from '../../tools/utils/toolEvents'

const findTool = (input: {
  toolName: string
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): StructuredToolInterface | undefined => {
  for (const skillId of input.learnedSkillIds) {
    const matched = (input.cache.skillToolsets[skillId] || []).find(
      (tool) => String(tool.name || '').trim() === input.toolName
    )
    if (matched) return matched
  }
  return undefined
}

const isToolCallResultCode = (value: string): value is ToolCallResultCode =>
  TOOL_CALL_RESULT_CODES.includes(value as ToolCallResultCode)

const parseToolCallResultCode = (input: {
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

const summarizePreviewRow = (value: JsonValue): string | undefined => {
  if (!isJsonObject(value)) return undefined

  const name =
    typeof value.name === 'string'
      ? value.name.trim()
      : typeof value.document_name === 'string'
        ? value.document_name.trim()
        : typeof value.id === 'string'
          ? value.id.trim()
          : ''
  const text =
    typeof value.text === 'string'
      ? clipText(value.text.trim().replace(/\s+/g, ' '), 80)
      : typeof value.summary === 'string'
        ? clipText(value.summary.trim().replace(/\s+/g, ' '), 80)
        : ''

  if (name && text) return `${name}: ${text}`
  if (name) return name
  if (text) return text
  return undefined
}

const summarizePreviewRows = (toolName: string, rows: readonly JsonValue[]): string => {
  const previews = rows
    .map((row) => summarizePreviewRow(row))
    .filter((value): value is string => value.length > 0)
    .slice(0, 3)

  if (previews.length === 0) {
    return `${toolName} returned ${rows.length} item(s)`
  }

  return `${toolName} returned ${rows.length} item(s): ${previews.join(' | ')}`
}

const summarizeObjectPayload = (toolName: string, payload: IpcJsonObject): string | undefined => {
  const items = Array.isArray(payload.items) ? payload.items : undefined
  if (items) {
    const total = typeof payload.total === 'number' ? payload.total : items.length
    const previews = items
      .map((row) => summarizePreviewRow(row))
      .filter((value): value is string => value.length > 0)
      .slice(0, 3)

    if (previews.length > 0) {
      return `${toolName} returned ${total} item(s): ${previews.join(' | ')}`
    }
    return `${toolName} returned ${total} item(s)`
  }

  const singlePreview = summarizePreviewRow(payload)
  if (singlePreview) {
    return `${toolName} returned ${singlePreview}`
  }

  return undefined
}

const DIAGNOSTIC_FIELD_CANDIDATES = [
  'type',
  'query',
  'replace',
  'blockId',
  'anchorBlockId',
  'content',
  'docId',
  'sourcePath',
  'outPath',
  'command',
  'cwd'
] as const

const extractMissingArgs = (message: string): string[] => {
  const found = new Set<string>()
  for (const field of DIAGNOSTIC_FIELD_CANDIDATES) {
    if (
      message.includes(`.${field}`) ||
      message.includes(`"${field}"`) ||
      message.includes(`'${field}'`) ||
      message.includes(` ${field} `)
    ) {
      found.add(field)
    }
  }
  return [...found]
}

const isToolCallDiagnosticKind = (
  value: string
): value is ToolCallDiagnostic['kind'] =>
  ['workspace_required', 'invalid_input', 'approval_denied', 'path_unavailable'].includes(value)

const inferDiagnosticFromFailure = (input: {
  code: ToolCallResultCode
  summary: string
  payload?: IpcJsonObject
}): ToolCallDiagnostic | undefined => {
  const explicit = input.payload?.diagnostic
  if (isJsonObject(explicit) && typeof explicit.kind === 'string' && isToolCallDiagnosticKind(explicit.kind)) {
    return {
      kind: explicit.kind,
      missingArgs: Array.isArray(explicit.missingArgs)
        ? explicit.missingArgs.map((item) => String(item).trim()).filter(Boolean)
        : undefined
    }
  }

  if (input.code === 'workspace_required') {
    return { kind: 'workspace_required' }
  }

  if (input.code === 'approval_denied') {
    return { kind: 'approval_denied' }
  }

  if (
    input.summary.includes('cwd does not exist inside workspace') ||
    input.summary.includes('sourcePath not found') ||
    input.summary.includes('effective docx path not found')
  ) {
    return { kind: 'path_unavailable' }
  }

  if (input.code === 'invalid_input') {
    const missingArgs = extractMissingArgs(input.summary)
    return {
      kind: 'invalid_input',
      missingArgs: missingArgs.length > 0 ? missingArgs : undefined
    }
  }

  return undefined
}

const normalizeToolCallResult = (
  toolName: string,
  payload: JsonValue
): ToolCallResult => {
  if (isJsonObject(payload)) {
    const ok = payload.ok !== false && payload.success !== false
    const code = parseToolCallResultCode({
      code: payload.code,
      ok: payload.ok === false ? false : payload.ok === true ? true : undefined,
      success: payload.success === false ? false : payload.success === true ? true : undefined
    })
    const summary =
      typeof payload.summary === 'string'
        ? payload.summary
        : typeof payload.error === 'string'
          ? payload.error
          : typeof payload.message === 'string'
            ? payload.message
            : summarizeObjectPayload(toolName, payload) || `${toolName} executed`

    return {
      toolName,
      ok,
      code,
      summary,
      data: payload,
      diagnostic: ok
        ? undefined
        : inferDiagnosticFromFailure({
            code,
            summary,
            payload
          })
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
      summary: summarizePreviewRows(toolName, payload),
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

export const executeToolCall = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  learnedSkillIds: RuntimeSkillId[]
  toolName: string
  args: Record<string, JsonValue>
}): Promise<ToolCallResult> => {
  const ctxWithOverride = input.ctx as AiRunContextWithHumanOverrides
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.ctx.runId,
    taskId: input.taskId,
    stage: 'human_hand'
  })
  const tool = findTool({
    toolName: input.toolName,
    learnedSkillIds: input.learnedSkillIds,
    cache: input.cache
  })
  if (!tool) {
    return {
      toolName: input.toolName,
      ok: false,
      code: 'invalid_input',
      summary: `当前未学习可执行工具 ${input.toolName}。`,
      diagnostic: {
        kind: 'invalid_input'
      }
    }
  }

  const injected = ctxWithOverride.resolveToolExecutionOverride?.({
    toolName: input.toolName,
    args: input.args
  })
  if (injected) {
    return await withToolLifecycle({
      emitter: toolEvents,
      toolName: input.toolName,
      args: input.args as IpcJsonObject,
      execute: async (session) => {
        const outputPreview = injected.data || injected.summary
        const normalizedInjected: ToolCallResult = {
          toolName: input.toolName,
          ok: injected.ok,
          code: injected.code,
          summary: injected.summary,
          data: injected.data,
          diagnostic: injected.diagnostic
        }
        if (injected.ok) {
          session.succeed(outputPreview)
        } else {
          session.fail(outputPreview, injected.summary)
        }
        return normalizedInjected
      }
    })
  }

  try {
    const result = await tool.invoke(input.args)
    return normalizeToolCallResult(input.toolName, result as JsonValue)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      toolName: input.toolName,
      ok: false,
      code: 'invalid_input',
      summary: message,
      diagnostic: inferDiagnosticFromFailure({
        code: 'invalid_input',
        summary: message
      })
    }
  }
}
