import { tool } from '@langchain/core/tools'
import type { ToolFamilyBuildInput } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import { MEMORY_TOOL_SPEC } from './toolSpecs'

export function buildMemoryTool({ ctx, runId, taskId }: ToolFamilyBuildInput) {
  const emitter = createToolEventEmitter({ ctx, runId, taskId })
  return tool(
    async (args) =>
      withToolLifecycle({
        emitter,
        toolName: 'memory',
        args,
        execute: async (session) => {
          ctx.checkCancelled()
          if (ctx.isSubagent) throw new Error('Memory changes are only available to the main agent')
          if (!ctx.partnerMemory) throw new Error('Memory service unavailable')
          ctx.partnerMemory.propose(ctx.partnerId, args.category, args)
          const data = {}
          session.succeed(undefined, { toolName: 'memory', ok: true, data })
          return data
        },
        onError: (error, session) =>
          session.fail(error.message, undefined, {
            toolName: 'memory',
            ok: false,
            data: { error: error.message }
          })
      }),
    { ...MEMORY_TOOL_SPEC.promptSpec, schema: MEMORY_TOOL_SPEC.inputSchema }
  )
}
