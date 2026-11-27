import { tool } from '@langchain/core/tools'
import { createWorkspaceBoundToolFamily } from '../utils/workspaceGuards'
import { createToolEventEmitter } from '../utils/toolEvents'
import { withToolLifecycle } from '../utils/lifecycle'
import {
  VIDEO_CLIP_TOOL_SPEC,
  VIDEO_VISUAL_TOOL_SPEC,
  VIDEO_AUDIO_TOOL_SPEC,
  VIDEO_EXPORT_TOOL_SPEC
} from './toolSpecs'
import { executeVideoEdit } from '../../../../media/video/VideoEditingService'
import type { HumanToolSpec, WorkspaceCapabilityBuildInput } from '../types'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'

const build = <T extends JsonObject>(
  input: WorkspaceCapabilityBuildInput,
  spec: HumanToolSpec<T>,
  kind: 'clip' | 'visual' | 'audio' | 'export'
) =>
  tool(
    async (args: T) =>
      withToolLifecycle({
        emitter: createToolEventEmitter({
          ctx: input.ctx,
          runId: input.runId,
          taskId: input.taskId
        }),
        toolName: spec.name,
        args,
        execute: async (session) => {
          const data = await executeVideoEdit(input.ctx, kind, args)
          session.succeed(undefined, {
            toolName: spec.name,
            ok: true,
            data: data as Record<string, JsonValue>
          })
          return data
        },
        onError: (error, session) =>
          session.fail(error.message, undefined, {
            toolName: spec.name,
            ok: false,
            data: { error: error.message }
          })
      }),
    { name: spec.name, description: spec.promptSpec.description, schema: spec.inputSchema }
  )

export const videoEditingToolFamily = createWorkspaceBoundToolFamily({
  familyId: 'video-editing',
  buildWorkspaceTools: (input) => [
    build(input, VIDEO_CLIP_TOOL_SPEC, 'clip'),
    build(input, VIDEO_VISUAL_TOOL_SPEC, 'visual'),
    build(input, VIDEO_AUDIO_TOOL_SPEC, 'audio'),
    build(input, VIDEO_EXPORT_TOOL_SPEC, 'export')
  ]
})
