import { randomUUID } from 'node:crypto'
import type { JsonObject, UserQuestion } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState, ToolCallResult } from '../../types'
import { appendLogEntriesToCache } from '../../memory/conversationLogMessages'
import { renderAskUserQuestionModelResult } from '../../shared/modelToolResultRenderers'
import { ASK_USER_QUESTION_SCHEMA } from '../../tools/agentControl/toolSchemas'
import { returnToBrain, returnToDispatch } from '../utils/stateTransitions'
import { emitToolProcessCompleted, emitToolProcessStarted } from '../../../events/processEvents'

export const createHumanInteractionNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    const action = state.execution.pendingRound?.nextAction
    if (!action || action.action !== 'interaction') return returnToBrain(state)
    const { questions } = ASK_USER_QUESTION_SCHEMA.parse(action.args)
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
      questions: questions satisfies UserQuestion[]
    })
    if (!response.accepted) throw new Error(response.error)
    const responseData: JsonObject = {
      answers: response.result.answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        ...(answer.userText ? { userText: answer.userText } : {})
      }))
    }
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
      data: responseData
    }
    const content = renderAskUserQuestionModelResult({
      toolName: 'ask_user_question',
      args: action.args,
      data: responseData
    })
    appendLogEntriesToCache(input.cache, [
      {
        kind: 'tool',
        toolCallId: action.toolCallId,
        toolName: 'ask_user_question',
        ok: true,
        content
      },
      {
        kind: 'annotation',
        eventType: 'human_interaction_resolved',
        payload: {
          interactionId,
          kind: 'question',
          result: responseData
        }
      }
    ])
    await input.ctx.appendMessageLog([
      {
        kind: 'tool',
        toolCallId: action.toolCallId,
        toolName: 'ask_user_question',
        ok: true,
        content
      },
      {
        kind: 'annotation',
        eventType: 'human_interaction_resolved',
        payload: {
          interactionId,
          kind: 'question',
          result: responseData
        }
      }
    ])
    return returnToDispatch(state, {
      execution: { pendingRound: undefined, lastToolResults: [result] }
    })
  }
}
