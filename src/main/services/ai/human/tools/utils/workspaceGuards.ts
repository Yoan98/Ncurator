import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { AiRunContext } from '../../../types'

export const buildWorkspaceRequiredResult = (error: string) => ({
  ok: false,
  code: 'workspace_required' as const,
  error
})

export const createWorkspaceRequiredGuardTool = <TSchema extends z.ZodType>(input: {
  name: string
  description: string
  schema: TSchema
  ctx: AiRunContext
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
