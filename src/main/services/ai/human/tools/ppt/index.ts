import { tool } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { createToolEventEmitter } from '../utils/toolEvents'
import { withToolLifecycle } from '../utils/lifecycle'
import { createPptToolRuntime, toPptToolFailure } from './runtime'
import {
  pptEditSchema,
  pptOutlineSchema,
  pptReadVisualsSchema,
  pptReadSlidesSchema,
  pptSearchSchema
} from './schemas'
import {
  PPT_EDIT_TOOL_SPEC,
  PPT_READ_OUTLINE_TOOL_SPEC,
  PPT_READ_SLIDES_TOOL_SPEC,
  PPT_READ_VISUALS_TOOL_SPEC,
  PPT_SEARCH_TOOL_SPEC
} from './toolSpecs'
import { createVisualRecognitionService } from '../visualRecognition/service'

type PptToolName =
  | 'ppt_read_outline'
  | 'ppt_read_slides'
  | 'ppt_search'
  | 'ppt_read_visuals'
  | 'ppt_edit'

const ACTIVITY_SUMMARY: Record<PptToolName, string> = {
  ppt_read_outline: '读取 PPT 提纲',
  ppt_read_slides: '读取 PPT 页面',
  ppt_search: '搜索 PPT',
  ppt_read_visuals: '读取 PPT 页面视觉内容',
  ppt_edit: '编辑 PPT'
}

export const buildPptCapabilityTools = (input: Parameters<typeof createPptToolRuntime>[0]) => {
  const runtime = createPptToolRuntime(input)
  input.cache.pptRuntime = runtime
  const emitter = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })
  const visualRecognitionService = createVisualRecognitionService(input.ctx)

  const createTool = <TSchema extends z.ZodType>(params: {
    name: PptToolName
    description: string
    schema: TSchema
    execute: (args: unknown) => Promise<Record<string, unknown>>
  }) =>
    tool(
      async (args) =>
        await withToolLifecycle({
          emitter,
          toolName: params.name,
          args: args as JsonObject,
          execute: async (session) => {
            const summary = ACTIVITY_SUMMARY[params.name]
            input.emitActivity({ actionType: params.name, status: 'started', summary })
            try {
              const result = await params.execute(args)
              session.succeed(undefined, {
                toolName: params.name,
                ok: true,
                data: result as JsonObject
              })
              input.emitActivity({
                actionType: params.name,
                status: 'completed',
                summary: `${summary}完成`
              })
              return result
            } catch (error) {
              const sourcePath =
                typeof (args as JsonObject)?.sourcePath === 'string'
                  ? String((args as JsonObject).sourcePath)
                  : ''
              const failure = toPptToolFailure(sourcePath, error)
              session.fail(String(failure.error || 'ppt tool failed'), undefined, {
                toolName: params.name,
                ok: false,
                data: failure
              })
              input.emitActivity({
                actionType: params.name,
                status: 'failed',
                summary: String(failure.error || 'ppt tool failed')
              })
              return failure
            }
          }
        }),
      { name: params.name, description: params.description, schema: params.schema }
    )

  return {
    runtime,
    tools: [
      createTool({
        name: 'ppt_read_outline',
        description: PPT_READ_OUTLINE_TOOL_SPEC.promptSpec.description,
        schema: pptOutlineSchema,
        execute: runtime.outline
      }),
      createTool({
        name: 'ppt_read_slides',
        description: PPT_READ_SLIDES_TOOL_SPEC.promptSpec.description,
        schema: pptReadSlidesSchema,
        execute: runtime.readSlides
      }),
      createTool({
        name: 'ppt_search',
        description: PPT_SEARCH_TOOL_SPEC.promptSpec.description,
        schema: pptSearchSchema,
        execute: runtime.search
      }),
      createTool({
        name: 'ppt_read_visuals',
        description: PPT_READ_VISUALS_TOOL_SPEC.promptSpec.description,
        schema: pptReadVisualsSchema,
        execute: async (rawArgs) => {
          const args = pptReadVisualsSchema.parse(rawArgs)
          const uniqueIndices = [...new Set(args.requests.map((request) => request.index))]
          const rendered = await runtime.render({
            sourcePath: args.sourcePath,
            ranges: uniqueIndices.map((index) => ({
              type: 'slide_index' as const,
              fromSlideIndex: index,
              toSlideIndex: index
            }))
          })
          const images = Array.isArray(rendered.images)
            ? rendered.images.flatMap((image) => {
                if (!image || typeof image !== 'object' || Array.isArray(image)) return []
                const record = image as JsonObject
                return typeof record.slideIndex === 'number' && typeof record.path === 'string'
                  ? [
                      {
                        index: record.slideIndex,
                        path: record.path,
                        mimeType:
                          typeof record.mimeType === 'string' ? record.mimeType : 'image/png'
                      }
                    ]
                  : []
              })
            : []
          const results = await visualRecognitionService.recognizeImages({
            images,
            requests: args.requests
          })
          return {
            sourcePath: args.sourcePath,
            results
          }
        }
      }),
      createTool({
        name: 'ppt_edit',
        description: PPT_EDIT_TOOL_SPEC.promptSpec.description,
        schema: pptEditSchema,
        execute: runtime.edit
      })
    ]
  }
}

export const pptToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'ppt',
  buildWorkspaceTools: (input) => buildPptCapabilityTools(input).tools
})
