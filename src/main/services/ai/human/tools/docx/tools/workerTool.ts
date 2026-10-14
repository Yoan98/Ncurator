import type { StructuredToolInterface } from '@langchain/core/tools'
import { tool } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../../shared/types'
import type { DocxToolFailure, DocxToolRuntime } from '../runtime'
import { buildDocxToolCallResult } from '../runtime'
import { withToolLifecycle } from '../../utils/lifecycle'

type DocxToolActivityConfig<TResult extends object> = {
  actionType: string
  startedSummary?: string
  buildCompletedSummary?: (result: TResult) => string
  buildFailedSummary?: (failure: DocxToolFailure) => string
}

export const finalizeDocxToolFailure = <TResult extends object>(input: {
  runtime: DocxToolRuntime
  failure: DocxToolFailure
  activity?: DocxToolActivityConfig<TResult>
}): DocxToolFailure => {
  if (input.activity) {
    input.runtime.input.emitActivity({
      actionType: input.activity.actionType,
      status: 'failed',
      summary: input.activity.buildFailedSummary?.(input.failure) || input.failure.error
    })
  }
  return input.failure
}

export const finalizeDocxToolSuccess = <TResult extends object>(input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  result: TResult
  outputPreview?: object
  draftDocId?: string
  activity?: DocxToolActivityConfig<TResult>
}): TResult => {
  input.runtime.toolEvents.emitResult({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    result: buildDocxToolCallResult({
      toolName: input.toolName,
      ok: true,
      data: input.result as JsonObject
    }),
    draftDocId: input.draftDocId
  })
  if (input.activity?.buildCompletedSummary) {
    input.runtime.input.emitActivity({
      actionType: input.activity.actionType,
      status: 'completed',
      summary: input.activity.buildCompletedSummary(input.result)
    })
  }
  return input.result
}

export const createDocxTool = <TSchema extends z.ZodType, TResult extends object>(input: {
  runtime: DocxToolRuntime
  name: string
  description: string
  schema: TSchema
  execute: (params: {
    args: z.infer<TSchema>
    toolName: string
    toolCallId: string
  }) => Promise<TResult | DocxToolFailure>
  onError?: (params: { args: z.infer<TSchema>; message: string }) => void
}): StructuredToolInterface =>
  tool(
    async (args) => {
      const parsedArgs = args as z.infer<TSchema>
      return await withToolLifecycle({
        emitter: input.runtime.toolEvents,
        toolName: input.name,
        args: parsedArgs as JsonObject,
        execute: async ({ toolName, toolCallId }) => {
          return await input.execute({
            args: parsedArgs,
            toolName,
            toolCallId
          })
        },
        onError: (error, { toolName, toolCallId }) => {
          input.runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'failed',
            error: error.message
          })
          input.onError?.({
            args: parsedArgs,
            message: error.message
          })
        }
      })
    },
    {
      name: input.name,
      description: input.description,
      schema: input.schema
    }
  )
