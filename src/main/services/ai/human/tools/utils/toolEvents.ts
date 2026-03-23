import { randomUUID } from 'node:crypto'
import type { IpcJsonObject, IpcJsonValue } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'

type DraftRef = {
  draftSnapshotId: string
  sourcePath?: string
  format: 'docx'
}

export const emitToolCallStarted = (input: {
  ctx: AiRunContext
  runId: string
  taskId?: string
  toolName: string
  args: IpcJsonObject
  stage?: 'human_hand'
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
    stage: input.stage
  })
  return toolCallId
}

export const emitToolCallResult = (input: {
  ctx: AiRunContext
  runId: string
  taskId?: string
  toolCallId: string
  toolName: string
  outputPreview: IpcJsonValue
  error?: string
  stage?: 'human_hand'
  draftRef?: DraftRef
}): void => {
  input.ctx.sendEvent({
    type: 'tool_call_result',
    runId: input.runId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    outputPreview: input.outputPreview,
    draftRef: input.draftRef,
    completedAt: Date.now(),
    error: input.error,
    stage: input.stage
  })
}

export const createToolEventEmitter = (input: {
  ctx: AiRunContext
  runId: string
  taskId?: string
  stage?: 'human_hand'
  resolveDraftRef?: (draftDocId: string) => DraftRef | undefined
}) => ({
  emitStarted: (toolName: string, args: IpcJsonObject): string =>
    emitToolCallStarted({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      toolName,
      args,
      stage: input.stage
    }),
  emitResult: (params: {
    toolName: string
    toolCallId: string
    outputPreview: IpcJsonValue
    error?: string
    draftDocId?: string
  }): void =>
    emitToolCallResult({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      outputPreview: params.outputPreview,
      error: params.error,
      stage: input.stage,
      draftRef:
        params.draftDocId && input.resolveDraftRef
          ? input.resolveDraftRef(params.draftDocId)
          : undefined
    })
})
