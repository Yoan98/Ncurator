import { emitActivity } from '../../../../../utils/aiCapabilityUtils'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiEventDispatchContext, AiRunContext } from '../../../types'
import { listToolNamesByFamily } from '../registry'
import type {
  AiToolFamilyId,
  CapabilityActivityInput,
  ToolFamilyDefinition,
  WorkspaceCapabilityBuildInput
} from '../types'

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
  buildWorkspaceTools: (
    buildInput: WorkspaceCapabilityBuildInput<AiRunContext>
  ) => StructuredToolInterface[]
}): ToolFamilyDefinition => ({
  familyId: input.familyId,
  buildTools: ({ ctx, cache, runId, taskId }) => {
    const workspaceRootPath = ctx.workspace?.rootPath
    if (!workspaceRootPath) {
      throw new Error('AI 运行必须绑定工作区，当前请求缺少工作区根目录。')
    }
    const toolNameSet = new Set(listToolNamesByFamily(input.familyId))
    return input
      .buildWorkspaceTools({
        ctx,
        cache,
        runId,
        sessionId: ctx.sessionId,
        taskId,
        workspaceRootPath,
        emitActivity: createWorkspaceCapabilityActivityEmitter({
          ctx,
          runId,
          taskId
        })
      })
      .filter((toolItem) => toolNameSet.has(String(toolItem.name || '').trim()))
  }
})
