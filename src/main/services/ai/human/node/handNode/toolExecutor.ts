import { releaseRunFiles } from '../../../run/fileLease'
import { releaseDocxRunSession } from '../../tools/docx/worker/docxWorkerClient'
import { assertToolAllowed } from '../../../run/toolPolicy'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'
import { isJsonObject } from '../../../../../utils/aiCapabilityUtils'
import type { AiRunContext } from '../../../types'
import { ensureToolsetTools } from '../toolsetLoadingNode/toolsetLoader'
import { resolveToolResultErrorText } from '../../shared/toolResultRenderers'
import {
  findEffectiveToolsetIdByToolName,
  getEffectiveLoadedToolsetIds,
  getToolsetDefinition
} from '../../toolsets'
import type { HumanRuntimeCache, RuntimeToolsetId, ToolCallResult } from '../../types'
import { withToolLifecycle } from '../../tools/utils/lifecycle'
import { createToolEventEmitter, withActiveToolCall } from '../../tools/utils/toolEvents'
import { isCancelledError } from '../../../utils/runFailure'
import { resolveToolErrorMessage } from '../../shared/toolError'

const findTool = (input: {
  toolName: string
  loadedToolsetIds: RuntimeToolsetId[]
  cache: HumanRuntimeCache
}): StructuredToolInterface | undefined => {
  for (const toolsetId of getEffectiveLoadedToolsetIds(input.loadedToolsetIds)) {
    const matched = (input.cache.toolsetTools[toolsetId] || []).find(
      (tool) => String(tool.name || '').trim() === input.toolName
    )
    if (matched) return matched
  }
  return undefined
}

const normalizeToolCallResult = (toolName: string, payload: JsonValue): ToolCallResult => {
  if (isJsonObject(payload)) {
    // 工具成败只由 error 推导；payload 不应再携带 ok/success
    const ok = typeof payload.error !== 'string'
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
        error: resolveToolErrorMessage(toolName, payload)
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
  loadedToolsetIds: RuntimeToolsetId[]
  toolCallId: string
  toolName: string
  args: Record<string, JsonValue>
}): Promise<ToolCallResult> => {
  assertToolAllowed(input.ctx, input.toolName)
  if (input.toolName === 'delegate_to_subagent') {
    // The parent pauses here. Relinquish its committed document sessions so children can
    // use those files and the parent reloads their latest contents after the handoff.
    await releaseDocxRunSession(input.ctx.runId)

    input.cache.docxRuntime = undefined
    input.cache.excelRuntime = undefined
    input.cache.pptRuntime = undefined
    for (const family of ['docx', 'excel', 'ppt'] as const)
      delete input.cache.familyToolsets[family]
    for (const toolsetId of getEffectiveLoadedToolsetIds(input.loadedToolsetIds)) {
      if (['docx', 'excel', 'ppt'].includes(getToolsetDefinition(toolsetId).familyId)) {
        delete input.cache.toolsetTools[toolsetId]
      }
    }
    releaseRunFiles(input.ctx.runId)
  }
  if (/^(docx_|ppt_|excel_|text_file_|image_generate)/.test(input.toolName)) {
    for (const key of ['sourcePath', 'outputPath']) {
      const sourcePath = input.args[key]
      if (typeof sourcePath === 'string' && !/^https?:/.test(sourcePath))
        input.ctx.acquireFile(sourcePath)
    }
  }
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.ctx.runId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    stage: 'human_hand'
  })
  const matchedToolsetId = findEffectiveToolsetIdByToolName({
    toolName: input.toolName,
    loadedToolsetIds: input.loadedToolsetIds
  })
  if (matchedToolsetId) {
    ensureToolsetTools({
      cache: input.cache,
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: input.taskId,
      toolsetId: matchedToolsetId
    })
  }
  const tool = findTool({
    toolName: input.toolName,
    loadedToolsetIds: input.loadedToolsetIds,
    cache: input.cache
  })
  if (!tool) {
    const result: ToolCallResult = {
      toolName: input.toolName,
      ok: false,
      data: {
        error: `Tool ${input.toolName} is not loaded or available for execution.`
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
              { toolName: input.toolName, toolCallId: input.toolCallId, args: input.args },
              () => tool.invoke(input.args)
            )) as JsonValue
          )
          if (result.ok) session.succeed(undefined, result)
          else session.fail(resolveToolResultErrorText(result), undefined, result)
          return result
        } catch (error) {
          if (isCancelledError(error)) throw error
          const result: ToolCallResult = {
            toolName: input.toolName,
            ok: false,
            data: { error: resolveToolErrorMessage(input.toolName, error) }
          }
          session.fail(resolveToolResultErrorText(result), undefined, result)
          return result
        }
      }
    })
  }

  try {
    const result = await withActiveToolCall(
      { toolName: input.toolName, toolCallId: input.toolCallId, args: input.args },
      () => tool.invoke(input.args)
    )
    return normalizeToolCallResult(input.toolName, result as JsonValue)
  } catch (error) {
    if (isCancelledError(error)) throw error
    return {
      toolName: input.toolName,
      ok: false,
      data: {
        error: resolveToolErrorMessage(input.toolName, error)
      }
    }
  }
}
