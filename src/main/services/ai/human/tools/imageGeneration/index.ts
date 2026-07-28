import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject } from '../../../../../../shared/types'
import type { WorkspaceCapabilityBuildInput } from '../types'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { generateImage } from './runtime'
import type { ImageGenerateInput } from './schemas'
import { IMAGE_GENERATE_TOOL_SPEC } from './toolSpecs'

export const buildImageGenerationCapabilityTools = (
  buildInput: WorkspaceCapabilityBuildInput
): { tools: StructuredToolInterface[] } => {
  const toolEvents = createToolEventEmitter({
    ctx: buildInput.ctx,
    runId: buildInput.runId,
    taskId: buildInput.taskId
  })
  const imageGenerate = tool(
    async (rawArgs) => {
      const args = rawArgs as ImageGenerateInput
      buildInput.emitActivity({
        actionType: IMAGE_GENERATE_TOOL_SPEC.name,
        status: 'started',
        summary: args.outputPath
      })
      return await withToolLifecycle({
        emitter: toolEvents,
        toolName: IMAGE_GENERATE_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          buildInput.ctx.checkCancelled()
          const result = await generateImage(buildInput, args)
          const toolResult: AiToolCallResult = {
            toolName: IMAGE_GENERATE_TOOL_SPEC.name,
            ok: true,
            data: result
          }
          session.succeed(undefined, toolResult)
          buildInput.emitActivity({
            actionType: IMAGE_GENERATE_TOOL_SPEC.name,
            status: 'completed',
            summary: args.outputPath
          })
          return result
        },
        onError: (error, session) => {
          const result: AiToolCallResult = {
            toolName: IMAGE_GENERATE_TOOL_SPEC.name,
            ok: false,
            data: { error: error.message }
          }
          session.fail(error.message, undefined, result)
          buildInput.emitActivity({
            actionType: IMAGE_GENERATE_TOOL_SPEC.name,
            status: 'failed',
            summary: error.message
          })
        }
      })
    },
    {
      name: IMAGE_GENERATE_TOOL_SPEC.name,
      description: IMAGE_GENERATE_TOOL_SPEC.promptSpec.description,
      schema: IMAGE_GENERATE_TOOL_SPEC.inputSchema
    }
  )
  return { tools: [imageGenerate] }
}

export const imageGenerationToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'image-generation',
  descriptionForTool: () => 'Generate an image from SVG content.',
  reason: 'image generation requires workspace binding before execution',
  error: 'workspace is required for image generation',
  buildWorkspaceTools: (input) => buildImageGenerationCapabilityTools(input).tools
})

export { IMAGE_GENERATE_TOOL_SPEC } from './toolSpecs'
