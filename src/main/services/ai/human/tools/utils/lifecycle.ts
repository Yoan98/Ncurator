import type {
  AiToolCallResult,
  IpcJsonObject,
  IpcJsonValue
} from '../../../../../../shared/types'
import type { ToolEventEmitter } from './toolEvents'

export type ToolLifecycleSession = {
  toolName: string
  toolCallId: string
  emitResult: (input: {
    outputPreview: IpcJsonValue
    result?: AiToolCallResult
    error?: string
    draftDocId?: string
  }) => void
  succeed: (outputPreview: IpcJsonValue, draftDocId?: string, result?: AiToolCallResult) => void
  fail: (
    outputPreview: IpcJsonValue,
    error: string,
    draftDocId?: string,
    result?: AiToolCallResult
  ) => void
}

export const withToolLifecycle = async <TResult>(input: {
  emitter: ToolEventEmitter
  toolName: string
  args: IpcJsonObject
  execute: (session: ToolLifecycleSession) => Promise<TResult>
  onError?: (error: Error, session: ToolLifecycleSession) => void | Promise<void>
}): Promise<TResult> => {
  const toolCallId = input.emitter.emitStarted(input.toolName, input.args)
  const session: ToolLifecycleSession = {
    toolName: input.toolName,
    toolCallId,
    emitResult: ({ outputPreview, result, error, draftDocId }) => {
      input.emitter.emitResult({
        toolName: input.toolName,
        toolCallId,
        outputPreview,
        result,
        error,
        draftDocId
      })
    },
    succeed: (outputPreview, draftDocId, result) => {
      input.emitter.emitResult({
        toolName: input.toolName,
        toolCallId,
        outputPreview,
        result,
        draftDocId
      })
    },
    fail: (outputPreview, error, draftDocId, result) => {
      input.emitter.emitResult({
        toolName: input.toolName,
        toolCallId,
        outputPreview,
        result,
        error,
        draftDocId
      })
    }
  }

  try {
    return await input.execute(session)
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    await input.onError?.(normalized, session)
    throw error
  }
}
