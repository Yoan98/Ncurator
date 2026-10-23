import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { AiToolCallResult, IpcJsonObject } from '../../../../../../shared/types'
import type { AiEventDispatchContext } from '../../../types'
import { emitToolProcessCompleted, emitToolProcessStarted } from '../../../events/processEvents'

type DraftRef = {
  draftSnapshotId: string
  sourcePath?: string
  format: 'docx'
}

type ActiveToolCallContext = {
  toolName: string
  toolCallId: string
}

const activeToolCallContext = new AsyncLocalStorage<ActiveToolCallContext>()

export const withActiveToolCall = <T>(context: ActiveToolCallContext, execute: () => T): T =>
  activeToolCallContext.run(context, execute)

const resolveToolCallId = (toolName: string, toolCallId?: string): string | undefined => {
  if (toolCallId) return toolCallId
  const activeCall = activeToolCallContext.getStore()
  return activeCall?.toolName === toolName ? activeCall.toolCallId : undefined
}

export const emitToolCallStarted = (input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  toolName: string
  args: IpcJsonObject
  stage?: 'human_hand' | 'human_toolset_loading' | 'human_skill_loading' | 'human_plan'
  toolCallId?: string
}): string => {
  const toolCallId = input.toolCallId || randomUUID()
  emitToolProcessStarted({
    sendEvent: input.ctx.sendEvent,
    runId: input.runId,
    toolCallId,
    toolName: input.toolName,
    args: input.args
  })
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
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  toolCallId: string
  toolName: string
  result?: AiToolCallResult
  error?: string
  stage?: 'human_hand' | 'human_toolset_loading' | 'human_skill_loading' | 'human_plan'
  draftRef?: DraftRef
}): void => {
  emitToolProcessCompleted({
    sendEvent: input.ctx.sendEvent,
    runId: input.runId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ok: input.result?.ok !== false && !input.error,
    error:
      input.error ||
      (input.result?.data &&
      typeof input.result.data === 'object' &&
      !Array.isArray(input.result.data) &&
      typeof input.result.data.error === 'string'
        ? input.result.data.error
        : undefined)
  })
  input.ctx.sendEvent({
    type: 'tool_call_result',
    runId: input.runId,
    taskId: input.taskId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    result: input.result,
    draftRef: input.draftRef,
    completedAt: Date.now(),
    error: input.error,
    stage: input.stage
  })
}

export const createToolEventEmitter = (input: {
  ctx: AiEventDispatchContext
  runId: string
  taskId?: string
  toolCallId?: string
  stage?: 'human_hand' | 'human_toolset_loading' | 'human_skill_loading' | 'human_plan'
  resolveDraftRef?: (draftDocId: string) => DraftRef | undefined
}) => ({
  emitStarted: (toolName: string, args: IpcJsonObject): string =>
    emitToolCallStarted({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      toolName,
      args,
      toolCallId: resolveToolCallId(toolName, input.toolCallId),
      stage: input.stage
    }),
  emitResult: (params: {
    toolName: string
    toolCallId: string
    result?: AiToolCallResult
    error?: string
    draftDocId?: string
  }): void =>
    emitToolCallResult({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      result: params.result,
      error: params.error,
      stage: input.stage,
      draftRef:
        params.draftDocId && input.resolveDraftRef
          ? input.resolveDraftRef(params.draftDocId)
          : undefined
    })
})

export type ToolEventEmitter = ReturnType<typeof createToolEventEmitter>
