import { tool } from '@langchain/core/tools'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { createToolEventEmitter } from '../utils/toolEvents'
import { withToolLifecycle } from '../utils/lifecycle'
import { createPptToolRuntime, toPptToolFailure } from './runtime'
import { pptEditSchema, pptOutlineSchema, pptReadSlidesSchema, pptSearchSchema } from './toolSchemas'
import {
  PPT_EDIT_TOOL_SPEC,
  PPT_READ_OUTLINE_TOOL_SPEC,
  PPT_READ_SLIDES_TOOL_SPEC,
  PPT_SEARCH_TOOL_SPEC
} from './toolSpecs'
import { ensureWorkspaceAssetBucket } from '../../../../assets/WorkspaceAssetService'

type PptToolName = 'ppt_read_outline' | 'ppt_read_slides' | 'ppt_search' | 'ppt_edit'

const ACTIVITY_SUMMARY: Record<PptToolName, string> = {
  ppt_read_outline: '读取 PPT 提纲',
  ppt_read_slides: '读取 PPT 页面',
  ppt_search: '搜索 PPT',
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

  const readSlidesWithImages = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptReadSlidesSchema.parse(rawArgs)
    const [readResult, rendered] = await Promise.all([
      runtime.readSlides(args),
      runtime.render(args)
    ])
    const bucket = await ensureWorkspaceAssetBucket(
      input.workspaceRootPath,
      `ppt_read_slides-${randomUUID()}`
    )
    const stagedBySlideId = new Map<string, string>()
    const renderedImages = Array.isArray(rendered.images) ? rendered.images : []
    for (const value of renderedImages) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      if (typeof record.slideId !== 'string' || typeof record.path !== 'string') continue
      const bytes = await fs.readFile(record.path)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const targetPath = path.join(bucket, `${hash}.png`)
      try {
        await fs.writeFile(targetPath, bytes, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      stagedBySlideId.set(record.slideId, targetPath)
    }
    const slides = Array.isArray(readResult.slides) ? readResult.slides : []
    return {
      ...readResult,
      detail: args.detail ?? 'full',
      slides: slides.map((value) => {
        const slide = value as Record<string, unknown>
        const slideId = String(slide.slideId || '')
        const slideImagePath = stagedBySlideId.get(slideId)
        if (!slideImagePath) throw new Error(`PPT 页面渲染缺失: ${slideId}`)
        return { ...slide, slideImagePath }
      })
    }
  }

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
        execute: readSlidesWithImages
      }),
      createTool({
        name: 'ppt_search',
        description: PPT_SEARCH_TOOL_SPEC.promptSpec.description,
        schema: pptSearchSchema,
        execute: runtime.search
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
