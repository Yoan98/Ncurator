import type {
  AiToolCallResult,
  IpcJsonObject
} from '../../../../../../shared/types'
import type { ToolEventEmitter } from './toolEvents'

export type ToolLifecycleSession = {
  toolName: string
  toolCallId: string
  emitResult: (input: {
    result?: AiToolCallResult
    error?: string
    draftDocId?: string
  }) => void
  succeed: (draftDocId?: string, result?: AiToolCallResult) => void
  fail: (
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
    emitResult: ({ result, error, draftDocId }) => {
      input.emitter.emitResult({
        toolName: input.toolName,
        toolCallId,
        result,
        error,
        draftDocId
      })
    },
    succeed: (draftDocId, result) => {
      input.emitter.emitResult({
        toolName: input.toolName,
        toolCallId,
        result,
        draftDocId
      })
    },
    fail: (error, draftDocId, result) => {
      input.emitter.emitResult({
        toolName: input.toolName,
        toolCallId,
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
