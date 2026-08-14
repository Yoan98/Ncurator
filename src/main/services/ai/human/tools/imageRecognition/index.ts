import { tool } from '@langchain/core/tools'
import type { IpcJsonObject } from '../../../../../../shared/types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import type { ToolFamilyDefinition } from '../types'
import { IMAGE_ANALYZE_TOOL_SPEC } from './toolSpecs'
import { createVisualRecognitionService, getImageMimeType } from '../visualRecognition/service'
import { resolveToolPath } from '../terminal/commandPolicy'

export const imageRecognitionToolFamily: ToolFamilyDefinition = createWorkspaceBoundToolFamily({
  familyId: 'image-recognition',
  descriptionForTool: (toolName) =>
    toolName === IMAGE_ANALYZE_TOOL_SPEC.name
      ? IMAGE_ANALYZE_TOOL_SPEC.promptSpec.description
      : IMAGE_ANALYZE_TOOL_SPEC.promptSpec.description,
  reason: 'image recognition tools require workspace binding before execution',
  error: 'workspace is required for image recognition tools',
  buildWorkspaceTools: (input) => {
    const { ctx, runId, taskId, workspaceRootPath } = input
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })
    const visualRecognitionService = createVisualRecognitionService(ctx)

    const llmRecognize = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: IMAGE_ANALYZE_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const rawPath = String(args.path || '').trim()
            const instruction = String(args.instruction || '').trim()
            const sourcePath = resolveToolPath({
              rawPath,
              cwd: workspaceRootPath
            })
            if (!sourcePath || !instruction) {
              const payload = { error: 'path 和 instruction 不能为空' }
              session.fail(payload.error, undefined, {
                toolName: IMAGE_ANALYZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }
            try {
              const result = await visualRecognitionService.recognizeImage({
                path: sourcePath,
                instruction,
                mimeType: getImageMimeType(sourcePath)
              })
              if ('error' in result) {
                const payload = { error: result.error }
                session.fail(payload.error, undefined, {
                  toolName: IMAGE_ANALYZE_TOOL_SPEC.name,
                  ok: false,
                  data: payload
                })
                return payload
              }
              session.succeed(undefined, {
                toolName: IMAGE_ANALYZE_TOOL_SPEC.name,
                ok: true,
                data: result.text
              })
              return result.text
            } catch (error) {
              const payload = {
                error: error instanceof Error ? error.message || '图像识别失败' : String(error)
              }
              session.fail(payload.error, undefined, {
                toolName: IMAGE_ANALYZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }
          }
        }),
      {
        name: IMAGE_ANALYZE_TOOL_SPEC.name,
        description: IMAGE_ANALYZE_TOOL_SPEC.promptSpec.description,
        schema: IMAGE_ANALYZE_TOOL_SPEC.inputSchema
      }
    )

    return [llmRecognize]
  }
})
