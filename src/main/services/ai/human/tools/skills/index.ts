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
import { SKILL_READ_SPEC, SKILL_EDIT_SPEC, renderSkillRead } from './toolSpecs'
import type { SkillReadOutput } from './outputTypes'

const result = (toolName: string, data: JsonValue, ok = true): AiToolCallResult => ({
  toolName,
  data,
  ok
})

export const skillManagementToolFamily: ToolFamilyDefinition = {
  familyId: 'skill-management',
  buildTools: ({ ctx, runId, taskId }) => {
    const emitter = createToolEventEmitter({ ctx, runId, taskId })
    const read = tool(
      async (args) =>
        withToolLifecycle({
          emitter,
          toolName: 'skill_read',
          args,
          execute: async (session) => {
            if (!ctx.userSkillService?.readForPartner)
              throw new Error('Skill management service unavailable')
            let payload: SkillReadOutput = ctx.userSkillService.readForPartner(
              ctx.partnerId,
              args.id
            )
            const rendered = renderSkillRead({ toolName: 'skill_read', args, data: payload })
            if (
              exceedsToolResultRejectLimit({
                totalBytes: countUtf8Bytes(rendered),
                totalLines: countPhysicalLines(rendered)
              })
            ) {
              if ('skills' in payload) {
                const persisted = await persistToolResult({
                  ctx,
                  toolCallId: session.toolCallId,
                  content: rendered
                })
                if (!persisted) throw new Error('Could not persist skill directory')
                payload = { filePath: persisted.filePath }
              } else if ('content' in payload) {
                payload = { id: payload.id, path: payload.path, enabled: payload.enabled }
              }
            }
            session.succeed(undefined, result('skill_read', payload))
            return payload
          },
          onError: (error, session) =>
            session.fail(
              error.message,
              undefined,
              result('skill_read', { error: error.message }, false)
            )
        }),
      { ...SKILL_READ_SPEC.promptSpec, schema: SKILL_READ_SPEC.inputSchema }
    )
    const edit = tool(
      async (args) =>
        withToolLifecycle({
          emitter,
          toolName: 'skill_edit',
          args: args as IpcJsonObject,
          execute: async (session) => {
            if (!ctx.userSkillService?.editForPartner)
              throw new Error('Skill management service unavailable')
            ctx.checkCancelled()
            const payload = ctx.userSkillService.editForPartner(ctx.partnerId, args)
            session.succeed(undefined, result('skill_edit', payload))
            return payload
          },
          onError: (error, session) =>
            session.fail(
              error.message,
              undefined,
              result('skill_edit', { error: error.message }, false)
            )
        }),
      { ...SKILL_EDIT_SPEC.promptSpec, schema: SKILL_EDIT_SPEC.inputSchema }
    )
    return [read, edit]
  }
}
