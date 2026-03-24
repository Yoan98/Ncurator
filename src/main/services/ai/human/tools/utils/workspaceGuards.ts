import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import { emitActivity } from '../../../../../utils/aiCapabilityUtils'
import type { AiEventDispatchContext, AiRunContext } from '../../../types'
import { jsonObjectSchema } from '../../schema'
import { listToolNamesByFamily } from '../catalog'
import type {
  AiToolFamilyId,
  CapabilityActivityInput,
  ToolFamilyDefinition,
  WorkspaceCapabilityBuildInput
} from '../types'

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

export const createWorkspaceCapabilityActivityEmitter = (input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId: string
}) => {
  return (activity: CapabilityActivityInput) => {
    emitActivity({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      actionType: activity.actionType,
      status: activity.status,
      summary: activity.summary
    })
  }
}

export const createWorkspaceBoundToolFamily = (input: {
  familyId: AiToolFamilyId
  descriptionForTool: (toolName: string) => string
  reason: string
  error: string
  buildWorkspaceTools: (
    buildInput: WorkspaceCapabilityBuildInput<AiRunContext>
  ) => StructuredToolInterface[]
}): ToolFamilyDefinition => ({
  familyId: input.familyId,
  buildTools: ({ ctx, runId, taskId }) => {
    const toolNames = listToolNamesByFamily(input.familyId)
    return buildWorkspaceBoundGuardedTools({
      toolNames,
      workspaceRootPath: ctx.workspace?.rootPath,
      descriptionForTool: input.descriptionForTool,
      schema: jsonObjectSchema.optional(),
      ctx,
      runId,
      taskId,
      reason: input.reason,
      error: input.error,
      buildWorkspaceTools: (workspaceRootPath) =>
        input.buildWorkspaceTools({
          ctx,
          runId,
          taskId,
          workspaceRootPath,
          emitActivity: createWorkspaceCapabilityActivityEmitter({
            ctx,
            runId,
            taskId
          })
        })
    })
  }
})
