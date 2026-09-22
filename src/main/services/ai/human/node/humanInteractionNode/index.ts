import { randomUUID } from 'node:crypto'
import type { JsonObject, UserQuestion } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState, ToolCallResult } from '../../types'
import { appendLogEntriesToCache } from '../../memory/conversationLogMessages'
import { renderAskUserQuestionModelResult } from '../../shared/modelToolResultRenderers'
import { returnToBrain } from '../utils/stateTransitions'
import { emitToolProcessCompleted, emitToolProcessStarted } from '../../../events/processEvents'

export const createHumanInteractionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    const action = state.execution.pendingRound?.nextAction
    if (!action || action.action !== 'interaction') return returnToBrain(state)
    const questions = Array.isArray(action.args.questions) ? action.args.questions : []
    if (questions.length < 1 || questions.length > 3) {
      throw new Error('ask_user_question requires 1 to 3 questions')
    }
    emitToolProcessStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId,
      toolCallId: action.toolCallId,
      toolName: 'ask_user_question',
      args: action.args,
      createdAt: Date.now()
    })
    const interactionId = randomUUID()
    const response = await input.ctx.requestUserQuestion({
      taskId: state.task.taskId,
      interactionId,
      toolCallId: action.toolCallId,
      questions: questions as unknown as UserQuestion[]
    })
    if (!response.accepted) throw new Error(response.error)
    // The renderer may have been refreshed while the question was pending. Re-emit
    // the stable tool activity so the resumed UI can reconstruct the question row.
    emitToolProcessStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId,
      toolCallId: action.toolCallId,
      toolName: 'ask_user_question',
      args: action.args,
      createdAt: Date.now()
    })
    emitToolProcessCompleted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId,
      toolCallId: action.toolCallId,
      toolName: 'ask_user_question',
      ok: true,
      completedAt: Date.now()
    })
    const result: ToolCallResult = {
      toolName: 'ask_user_question',
      ok: true,
      data: response.result as unknown as JsonObject
    }
    const content = renderAskUserQuestionModelResult({
      toolName: 'ask_user_question',
      args: action.args,
      data: response.result as unknown as JsonObject
    })
    appendLogEntriesToCache(input.cache, [
      { kind: 'tool', toolCallId: action.toolCallId, toolName: 'ask_user_question', ok: true, content },
      {
        kind: 'annotation',
        eventType: 'human_interaction_resolved',
        payload: { interactionId, kind: 'question', result: response.result as unknown as JsonObject }
      }
    ])
    await input.ctx.appendMessageLog([
      { kind: 'tool', toolCallId: action.toolCallId, toolName: 'ask_user_question', ok: true, content },
      {
        kind: 'annotation',
        eventType: 'human_interaction_resolved',
        payload: { interactionId, kind: 'question', result: response.result as unknown as JsonObject }
      }
    ])
    return returnToBrain(state, {
      execution: { pendingRound: undefined, lastToolResults: [result] }
    })
  }
}
