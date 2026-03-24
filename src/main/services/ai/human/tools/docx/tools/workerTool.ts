import type { StructuredToolInterface } from '@langchain/core/tools'
import { tool } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type { IpcJsonValue, JsonObject } from '../../../../../../../shared/types'
import type { DocxToolFailure, DocxToolRuntime } from '../runtime'
import type {
  DocxWorkerAction,
  DocxWorkerRequest,
  DocxWorkerSuccessPayload
} from '../worker/types'
import { withToolLifecycle } from '../../utils/lifecycle'

export const isDocxToolFailure = (
  value: DocxToolFailure | DocxWorkerSuccessPayload
): value is DocxToolFailure => 'ok' in value && value.ok === false

type DocxToolActivityConfig<TResult extends object> = {
  actionType: string
  startedSummary?: string
  buildCompletedSummary?: (result: TResult) => string
  buildFailedSummary?: (failure: DocxToolFailure) => string
}

const emitDocxToolStarted = <TResult extends object>(input: {
  runtime: DocxToolRuntime
  activity?: DocxToolActivityConfig<TResult>
}) => {
  if (!input.activity?.startedSummary) return
  input.runtime.input.emitActivity({
    actionType: input.activity.actionType,
    status: 'started',
    summary: input.activity.startedSummary
  })
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
      summary: input.activity.buildFailedSummary?.(input.failure) || input.failure.summary
    })
  }
  return input.failure
}

export const finalizeDocxToolSuccess = <TResult extends object>(input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  result: TResult
  outputPreview: IpcJsonValue
  draftDocId?: string
  activity?: DocxToolActivityConfig<TResult>
}): TResult => {
  input.runtime.toolEvents.emitResult({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    outputPreview: input.outputPreview,
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

export const runDocxWorkerToolAction = async <
  TAction extends DocxWorkerAction,
  TResult extends object
>(input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>
  expectedAction: TAction
  draftDocId?: string
  activity?: DocxToolActivityConfig<TResult>
  buildSuccess: (
    payload: Extract<DocxWorkerSuccessPayload, { action: TAction }>
  ) =>
    | {
        result: TResult
        outputPreview: IpcJsonValue
        draftDocId?: string
      }
    | Promise<{
        result: TResult
        outputPreview: IpcJsonValue
        draftDocId?: string
      }>
}): Promise<TResult | DocxToolFailure> => {
  emitDocxToolStarted({
    runtime: input.runtime,
    activity: input.activity
  })
  const workerPayload = await callExpectedWorkerAction({
    runtime: input.runtime,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    request: input.request,
    expectedAction: input.expectedAction,
    draftDocId: input.draftDocId
  })
  if (isDocxToolFailure(workerPayload)) {
    return finalizeDocxToolFailure({
      runtime: input.runtime,
      failure: workerPayload,
      activity: input.activity
    })
  }

  const success = await input.buildSuccess(workerPayload)
  return finalizeDocxToolSuccess({
    runtime: input.runtime,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    result: success.result,
    outputPreview: success.outputPreview,
    draftDocId: success.draftDocId,
    activity: input.activity
  })
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
        execute: async ({ toolName, toolCallId }) =>
          await input.execute({
            args: parsedArgs,
            toolName,
            toolCallId
          }),
        onError: (error, { toolName, toolCallId }) => {
          input.runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
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
