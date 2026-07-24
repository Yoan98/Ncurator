import path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { IpcJsonObject } from '../../../../../../shared/types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { IMAGE_ANALYZE_TOOL_SPEC } from './toolSpecs'
import { createVisualRecognitionService, getImageMimeType } from '../visualRecognition/service'

const isPathInsideWorkspace = (input: {
  workspaceRootPath: string
  targetPath: string
}): boolean => {
  const relativePath = path.relative(input.workspaceRootPath, input.targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const imageRecognitionToolFamily: ToolFamilyDefinition = {
  familyId: 'image-recognition',
  buildTools: ({ ctx, runId, taskId }) => {
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
            const sourcePath = path.resolve(String(args.path || '').trim())
            const instruction = String(args.instruction || '').trim()
            if (!sourcePath || !instruction) {
              const payload = { error: 'path 和 instruction 不能为空' }
              session.fail(payload.error, undefined, {
                toolName: IMAGE_ANALYZE_TOOL_SPEC.name,
                ok: false,
                data: payload
              })
              return payload
            }
            if (
              !ctx.workspace?.rootPath ||
              !isPathInsideWorkspace({
                workspaceRootPath: ctx.workspace.rootPath,
                targetPath: sourcePath
              })
            ) {
              const payload = { error: '图片路径必须位于当前工作区内' }
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
}
