import { tool } from '@langchain/core/tools'
import type { IpcJsonObject } from '../../../../../../shared/types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { WAIT_TIME_TOOL_SPEC } from './toolSpecs'

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const utilityToolFamily: ToolFamilyDefinition = {
  familyId: 'utility',
  buildTools: ({ ctx, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId
    })

    const waitTime = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: WAIT_TIME_TOOL_SPEC.name,
          args: args as IpcJsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const seconds = Math.max(0, Math.min(60, Number(args.seconds || 0)))
            const waitMs = Math.round(seconds * 1000)
            const startedAt = Date.now()
            await sleep(waitMs)
            const payload = {
              waitedMs: Date.now() - startedAt
            }
            session.succeed(undefined, {
              toolName: WAIT_TIME_TOOL_SPEC.name,
              ok: true,
              data: payload
            })
            return payload
          }
        }),
      {
        name: WAIT_TIME_TOOL_SPEC.name,
        description: WAIT_TIME_TOOL_SPEC.promptSpec.description,
        schema: WAIT_TIME_TOOL_SPEC.inputSchema
      }
    )

    return [waitTime]
  }
}
