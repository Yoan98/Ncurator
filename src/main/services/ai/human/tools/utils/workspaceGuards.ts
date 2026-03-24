import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { AiEventDispatchContext } from '../../../types'

export const buildWorkspaceRequiredResult = (error: string) => ({
  ok: false,
  code: 'workspace_required' as const,
  error
})

export const createWorkspaceRequiredGuardTool = <TSchema extends z.ZodType>(input: {
  name: string
  description: string
  schema: TSchema
  ctx: AiEventDispatchContext
  runId: string
  taskId: string
  reason: string
  error: string
}): StructuredToolInterface =>
  tool(
    async () => {
      input.ctx.sendEvent({
        type: 'workspace_required',
        runId: input.runId,
        taskId: input.taskId,
        reason: input.reason,
        requiredFields: ['workspaceId', 'rootPath'],
        createdAt: Date.now(),
        stage: 'human_hand'
      })
      return buildWorkspaceRequiredResult(input.error)
    },
    {
      name: input.name,
      description: input.description,
      schema: input.schema
    }
  )

export const buildWorkspaceBoundGuardedTools = <TSchema extends z.ZodType>(input: {
  toolNames: string[]
  workspaceRootPath?: string
  descriptionForTool: (toolName: string) => string
  schema: TSchema
  ctx: AiEventDispatchContext
  runId: string
  taskId: string
  reason: string
  error: string
  buildWorkspaceTools: (workspaceRootPath: string) => StructuredToolInterface[]
}): StructuredToolInterface[] => {
  const workspaceRootPath = String(input.workspaceRootPath || '').trim()
  if (!workspaceRootPath) {
    return input.toolNames.map((name) =>
      createWorkspaceRequiredGuardTool({
        name,
        description: input.descriptionForTool(name),
        schema: input.schema,
        ctx: input.ctx,
        runId: input.runId,
        taskId: input.taskId,
        reason: input.reason,
        error: input.error
      })
    )
  }

  const toolNameSet = new Set(input.toolNames)
  return input
    .buildWorkspaceTools(workspaceRootPath)
    .filter((toolItem) => toolNameSet.has(String(toolItem.name || '').trim()))
}
