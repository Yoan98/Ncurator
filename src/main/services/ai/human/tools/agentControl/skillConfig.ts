import { tool } from '@langchain/core/tools'
import type { AiToolCallResult } from '../../../../../../shared/types'
import type { SkillStatus } from '../../../../skills/UserSkillService'
import type { ToolFamilyBuildInput } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { exceedsToolResultRejectLimit } from '../../shared/modelToolResult'
import {
  persistToolResult,
  countPhysicalLines,
  countUtf8Bytes
} from '../../shared/toolResultPersistence'
import { renderSkillConfigModelResult } from '../../shared/modelToolResultRenderers'
import { SKILL_CONFIG_TOOL_SPEC } from './toolSpecs'

export function buildSkillConfigTool({ ctx, runId, taskId }: ToolFamilyBuildInput) {
  const emitter = createToolEventEmitter({ ctx, runId, taskId })
  return tool(
    async (args) =>
      withToolLifecycle({
        emitter,
        toolName: 'skill_config',
        args,
        execute: async (session) => {
          const service = ctx.userSkillService
          if (!service?.statusForPartner || !service.configureForPartner)
            throw new Error('Skill configuration service unavailable')
          ctx.checkCancelled()
          let data: SkillStatus[] | SkillStatus | { filePath: string } =
            args.enabled === undefined
              ? service.statusForPartner(ctx.partnerId, args.name)
              : service.configureForPartner(ctx.partnerId, args.name!, args.enabled)
          const rendered = renderSkillConfigModelResult({ toolName: 'skill_config', args, data })
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
            if (!saved) throw new Error('Could not persist Skill configuration list')
            data = { filePath: saved.filePath }
          }
          session.succeed(undefined, { toolName: 'skill_config', ok: true, data })
          return data
        },
        onError: (error, session) => {
          const result: AiToolCallResult = {
            toolName: 'skill_config',
            ok: false,
            data: { error: error.message }
          }
          session.fail(error.message, undefined, result)
        }
      }),
    { ...SKILL_CONFIG_TOOL_SPEC.promptSpec, schema: SKILL_CONFIG_TOOL_SPEC.inputSchema }
  )
}
