import type { StructuredToolInterface } from '@langchain/core/tools'
import { tool } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../../shared/types'
import type { DocxToolFailure, DocxToolRuntime } from '../runtime'
import type {
  DocxWorkerAction,
  DocxWorkerRequest,
  DocxWorkerSuccessPayload
} from '../worker/types'

export const isDocxToolFailure = (
  value: DocxToolFailure | DocxWorkerSuccessPayload
): value is DocxToolFailure => 'ok' in value && value.ok === false

export const callExpectedWorkerAction = async <TAction extends DocxWorkerAction>(input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>
  expectedAction: TAction
  draftDocId?: string
}): Promise<Extract<DocxWorkerSuccessPayload, { action: TAction }> | DocxToolFailure> => {
  const workerResponse = await input.runtime.callWorker(input.request)
  if (!workerResponse.ok) {
    return input.runtime.emitWorkerFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      response: workerResponse,
      draftDocId: input.draftDocId
    })
  }
  if (workerResponse.payload.action !== input.expectedAction) {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      code: 'failed',
      error: `worker protocol mismatch (${input.expectedAction})`,
      draftDocId: input.draftDocId
    })
  }
  return workerResponse.payload as Extract<DocxWorkerSuccessPayload, { action: TAction }>
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
      const toolName = input.name
      const toolCallId = input.runtime.toolEvents.emitStarted(toolName, parsedArgs as JsonObject)
      try {
        return await input.execute({
          args: parsedArgs,
          toolName,
          toolCallId
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        input.runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: message
        })
        input.onError?.({
          args: parsedArgs,
          message
        })
        throw error
      }
    },
    {
      name: input.name,
      description: input.description,
      schema: input.schema
    }
  )
