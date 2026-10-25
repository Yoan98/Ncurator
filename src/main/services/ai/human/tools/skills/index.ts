import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, JsonValue, IpcJsonObject } from '../../../../../../shared/types'
import type { ToolFamilyDefinition } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { exceedsToolResultRejectLimit } from '../../shared/modelToolResult'
import {
  persistToolResult,
  countPhysicalLines,
  countUtf8Bytes
} from '../../shared/toolResultPersistence'
import { SKILL_SYNC_SPEC, renderSkillSync } from './toolSpecs'
import type { SkillSyncOutput } from './outputTypes'

const result = (data: JsonValue, ok = true): AiToolCallResult => ({
  toolName: 'skill_sync',
  data,
  ok
})

export const skillManagementToolFamily: ToolFamilyDefinition = {
  familyId: 'skill-management',
  buildTools: ({ ctx, runId, taskId }) => {
    const emitter = createToolEventEmitter({ ctx, runId, taskId })
    return [
      tool(
        async (args) =>
          withToolLifecycle({
            emitter,
            toolName: 'skill_sync',
            args: args as IpcJsonObject,
            execute: async (session) => {
              const service = ctx.userSkillService
              if (!service?.statusForPartner || !service.syncForPartner)
                throw new Error('Skill management service unavailable')
              ctx.checkCancelled()
              let payload: SkillSyncOutput =
                args.action === 'status'
                  ? service.statusForPartner(ctx.partnerId, args.name)
                  : service.syncForPartner(ctx.partnerId, args.name!, args.enabled)
              const rendered = renderSkillSync({ toolName: 'skill_sync', args, data: payload })
              if (
                exceedsToolResultRejectLimit({
                  totalBytes: countUtf8Bytes(rendered),
                  totalLines: countPhysicalLines(rendered)
                })
              ) {
                const saved = await persistToolResult({
                  ctx,
                  toolCallId: session.toolCallId,
                  content: rendered
                })
                if (!saved) throw new Error('Could not persist Skill status list')
                payload = { filePath: saved.filePath }
              }
              session.succeed(undefined, result(payload))
              return payload
            },
            onError: (error, session) =>
              session.fail(error.message, undefined, result({ error: error.message }, false))
          }),
        { ...SKILL_SYNC_SPEC.promptSpec, schema: SKILL_SYNC_SPEC.inputSchema }
      )
    ]
  }
}
