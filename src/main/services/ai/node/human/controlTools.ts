import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type { IpcJsonObject, IpcJsonValue } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'

const jsonValueSchema: z.ZodType<IpcJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

const emitToolStarted = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
  toolName: string
  args: IpcJsonObject
}): string => {
  const toolCallId = randomUUID()
  input.ctx.sendEvent({
    type: 'tool_call_started',
    runId: input.runId,
    taskId: input.taskId,
    toolCallId,
    toolName: input.toolName,
    input: input.args,
    createdAt: Date.now(),
    stage: 'human_tool_exec'
  })
  return toolCallId
}

const emitToolResult = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
  toolName: string
  toolCallId: string
  outputPreview: IpcJsonValue
  error?: string
}) => {
  input.ctx.sendEvent({
    type: 'tool_call_result',
    runId: input.runId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    outputPreview: input.outputPreview,
    completedAt: Date.now(),
    error: input.error,
    stage: 'human_tool_exec'
  })
}

export const buildHumanControlTools = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
}) => {
  // control tools 用于显式结束 task，避免 brain 以自然语言“隐式结束”。
  const completeTaskTool = tool(
    async (args) => {
      const toolName = 'complete_task'
      const toolCallId = emitToolStarted({
        ctx: input.ctx,
        runId: input.runId,
        taskId: input.taskId,
        toolName,
        args
      })
      const summary = String(args.summary || '').trim()
      const result = {
        status: 'completed' as const,
        summary,
        outputs: args.outputs
      }
      emitToolResult({
        ctx: input.ctx,
        runId: input.runId,
        taskId: input.taskId,
        toolName,
        toolCallId,
        outputPreview: result
      })
      return result
    },
    {
      name: 'complete_task',
      description: 'Finish current task successfully.',
      schema: z.object({
        summary: z.string().min(1),
        outputs: z.record(z.string(), jsonValueSchema).optional()
      })
    }
  )

  const blockTaskTool = tool(
    async (args) => {
      const toolName = 'block_task'
      const toolCallId = emitToolStarted({
        ctx: input.ctx,
        runId: input.runId,
        taskId: input.taskId,
        toolName,
        args
      })
      const reason = String(args.reason || '').trim()
      const result = {
        status: 'blocked' as const,
        reason,
        details: args.details
      }
      emitToolResult({
        ctx: input.ctx,
        runId: input.runId,
        taskId: input.taskId,
        toolName,
        toolCallId,
        outputPreview: result
      })
      return result
    },
    {
      name: 'block_task',
      description: 'Block current task with clear reason.',
      schema: z.object({
        reason: z.string().min(1),
        details: jsonValueSchema.optional()
      })
    }
  )

  return [completeTaskTool, blockTaskTool]
}
