import { tool } from '@langchain/core/tools'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { DRAWING_TOOL_SPEC } from './toolSpecs'
import { createDrawing } from './runtime'

export const drawingToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'drawing',
  buildWorkspaceTools: (input) => [
    tool(
      async (args) =>
        withToolLifecycle({
          emitter: createToolEventEmitter({
            ctx: input.ctx,
            runId: input.runId,
            taskId: input.taskId
          }),
          toolName: 'drawing',
          args,
          execute: async (session) => {
            const data = await createDrawing(input.ctx, args, session.toolCallId)
            session.succeed(undefined, { toolName: 'drawing', ok: true, data })
            return data
          },
          onError: (error, session) =>
            session.fail(error.message, undefined, {
              toolName: 'drawing',
              ok: false,
              data: { error: error.message }
            })
        }),
      {
        name: 'drawing',
        description: DRAWING_TOOL_SPEC.promptSpec.description,
        schema: DRAWING_TOOL_SPEC.inputSchema
      }
    )
  ]
})
