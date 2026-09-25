import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'
import { isJsonObject } from '../../../../../utils/aiCapabilityUtils'
import { clipText } from '../../../utils/text'
import type { AiRunContext } from '../../../types'
import { ensureSkillTools } from '../learningNode/skillLoader'
import { resolveToolResultErrorText } from '../../shared/toolResultRenderers'
import { findEffectiveSkillIdByToolName, getEffectiveLearnedSkillIds } from '../../skills'
import type { HumanRuntimeCache, RuntimeSkillId, ToolCallResult } from '../../types'
import { withToolLifecycle } from '../../tools/utils/lifecycle'
import { createToolEventEmitter, withActiveToolCall } from '../../tools/utils/toolEvents'
import { isCancelledError } from '../../../utils/runFailure'

const findTool = (input: {
  toolName: string
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): StructuredToolInterface | undefined => {
  for (const skillId of getEffectiveLearnedSkillIds(input.learnedSkillIds)) {
    const matched = (input.cache.skillToolsets[skillId] || []).find(
      (tool) => String(tool.name || '').trim() === input.toolName
    )
    if (matched) return matched
  }
  return undefined
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
    typeof value.text === 'string' ? clipText(value.text.trim().replace(/\s+/g, ' '), 80) : ''

  if (name && text) return `${name}: ${text}`
  if (name) return name
  if (text) return text
  return undefined
}

const summarizeObjectPayload = (toolName: string, payload: JsonObject): string | undefined => {
  const items = Array.isArray(payload.items) ? payload.items : undefined
  if (items) {
    const total = typeof payload.total === 'number' ? payload.total : items.length
    const previews = items
      .map((row) => summarizePreviewRow(row))
      .filter((value): value is string => Boolean(value && value.length > 0))
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

const resolvePayloadMessage = (toolName: string, payload: JsonObject): string =>
  typeof payload.error === 'string'
    ? payload.error
    : typeof payload.message === 'string'
      ? payload.message
      : summarizeObjectPayload(toolName, payload) || `${toolName} executed`

const normalizeToolCallResult = (toolName: string, payload: JsonValue): ToolCallResult => {
  if (isJsonObject(payload)) {
    const explicitError =
      typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : undefined
    // 工具成败只由 error 推导；payload 不应再携带 ok/success
    const ok = !explicitError
    const payloadMessage = resolvePayloadMessage(toolName, payload)
    const data = { ...payload }
    const imageRefs =
      toolName === 'read_image' && Array.isArray(data.images)
        ? data.images.flatMap((value) => {
            if (
              !isJsonObject(value) ||
              typeof value.path !== 'string' ||
              typeof value.mimeType !== 'string' ||
              typeof value.sizeBytes !== 'number' ||
              typeof value.width !== 'number' ||
              typeof value.height !== 'number'
            )
              return []
            return [
              {
                path: value.path,
                mimeType: value.mimeType,
                sizeBytes: value.sizeBytes,
                width: value.width,
                height: value.height
              }
            ]
          })
        : undefined
    const candidateResourceContext = data.resourceContext
    // 剥离历史信封残留，避免与 ToolCallResult.ok 双通道重复
    delete data.ok
    delete data.success
    delete data.code
    delete data.summary
    delete data.resourceContext

    const resourceContext = (() => {
      const candidate = candidateResourceContext
      if (
        isJsonObject(candidate) &&
        typeof candidate.family === 'string' &&
        candidate.family.trim().length > 0
      ) {
        return {
          family: candidate.family,
          sourcePath: typeof candidate.sourcePath === 'string' ? candidate.sourcePath : undefined,
          currentRevisionRef:
            typeof candidate.currentRevisionRef === 'string'
              ? candidate.currentRevisionRef
              : undefined,
          previousRevisionRef:
            typeof candidate.previousRevisionRef === 'string'
              ? candidate.previousRevisionRef
              : undefined,
          effectKind: typeof candidate.effectKind === 'string' ? candidate.effectKind : undefined
        }
      }
      return undefined
    })()
    if (ok) {
      return {
        toolName,
        ok: true,
        data,
        imageRefs,
        resourceContext
      }
    }
    return {
      toolName,
      ok: false,
      data: {
        ...data,
        error: explicitError || payloadMessage || `${toolName} failed`
      },
      resourceContext
    }
  }

  if (typeof payload === 'string') {
    return {
      toolName,
      ok: true,
      data: payload
    }
  }

  if (Array.isArray(payload)) {
    return {
      toolName,
      ok: true,
      data: payload
    }
  }

  return {
    toolName,
    ok: true,
    data: payload
  }
}

export const executeToolCall = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  learnedSkillIds: RuntimeSkillId[]
  toolCallId: string
  toolName: string
  args: Record<string, JsonValue>
}): Promise<ToolCallResult> => {
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.ctx.runId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    stage: 'human_hand'
  })
  const matchedSkillId = findEffectiveSkillIdByToolName({
    toolName: input.toolName,
    learnedSkillIds: input.learnedSkillIds
  })
  if (matchedSkillId) {
    ensureSkillTools({
      cache: input.cache,
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: input.taskId,
      skillId: matchedSkillId
    })
  }
  const tool = findTool({
    toolName: input.toolName,
    learnedSkillIds: input.learnedSkillIds,
    cache: input.cache
  })
  if (!tool) {
    const result: ToolCallResult = {
      toolName: input.toolName,
      ok: false,
      data: {
        error: `当前未学习可执行工具 ${input.toolName}。`
      }
    }
    return await withToolLifecycle({
      emitter: toolEvents,
      toolName: input.toolName,
      args: input.args as JsonObject,
      execute: async (session) => {
        session.fail(resolveToolResultErrorText(result), undefined, result)
        return result
      }
    })
  }

  if (input.toolName === 'read_image') {
    return await withToolLifecycle({
      emitter: toolEvents,
      toolName: input.toolName,
      args: input.args as JsonObject,
      execute: async (session) => {
        try {
          const result = normalizeToolCallResult(
            input.toolName,
            (await withActiveToolCall(
              { toolName: input.toolName, toolCallId: input.toolCallId },
              () => tool.invoke(input.args)
            )) as JsonValue
          )
          if (result.ok) session.succeed(undefined, result)
          else session.fail(resolveToolResultErrorText(result), undefined, result)
          return result
        } catch (error) {
          const result: ToolCallResult = {
            toolName: input.toolName,
            ok: false,
            data: { error: error instanceof Error ? error.message : String(error) }
          }
          session.fail(resolveToolResultErrorText(result), undefined, result)
          return result
        }
      }
    })
  }

  try {
    const result = await withActiveToolCall(
      { toolName: input.toolName, toolCallId: input.toolCallId },
      () => tool.invoke(input.args)
    )
    return normalizeToolCallResult(input.toolName, result as JsonValue)
  } catch (error) {
    if (isCancelledError(error)) throw error
    const message = error instanceof Error ? error.message : String(error)
    return {
      toolName: input.toolName,
      ok: false,
      data: {
        error: message
      }
    }
  }
}
