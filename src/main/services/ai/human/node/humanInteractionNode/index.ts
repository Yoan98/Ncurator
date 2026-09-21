import { randomUUID } from 'node:crypto'
import type { JsonObject, UserQuestion } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState, ToolCallResult } from '../../types'
import { appendLogEntriesToCache } from '../../memory/conversationLogMessages'
import { returnToBrain } from '../utils/stateTransitions'

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
    const interactionId = randomUUID()
    const response = await input.ctx.requestUserQuestion({
      taskId: state.task.taskId,
      interactionId,
      toolCallId: action.toolCallId,
      questions: questions as unknown as UserQuestion[]
    })
    if (!response.accepted) throw new Error(response.error)
    const result: ToolCallResult = {
      toolName: 'ask_user_question',
      ok: true,
      data: response.result as unknown as JsonObject
    }
    const content = JSON.stringify(response.result)
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
