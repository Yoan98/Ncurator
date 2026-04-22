import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { buildMouthPrompt } from '../../prompts/mouth'
import { completeHumanTask } from '../utils/stateTransitions'
import { deriveDeliverySummary } from '../../shared/deliverySummary'
import {
  appendFileReviewArtifactsAndEmitEvents,
  buildRuntimeArtifactsSummaryFromFileReviewDetails,
  mergeArtifactRefs
} from '../../../utils/artifacts'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  emitAnswerEvents: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const fileReviewDetails = await input.ctx.finalizeDocxReviewRun()
    const runtimeArtifacts = buildRuntimeArtifactsSummaryFromFileReviewDetails(fileReviewDetails)
    const artifacts =
      fileReviewDetails.length > 0
        ? appendFileReviewArtifactsAndEmitEvents({
            existingArtifacts: state.execution.artifacts,
            details: fileReviewDetails,
            sendEvent: input.ctx.sendEvent,
            runId: input.ctx.runId,
            taskId: state.task.taskId
          })
        : mergeArtifactRefs(state.execution.artifacts)
    const readyState: HumanState = {
      ...state,
      execution: {
        ...state.execution,
        artifacts,
        runtimeArtifacts
      }
    }
    input.cache.currentState = readyState

    const prompt = buildMouthPrompt({ state: readyState, ctx: input.ctx })
    const rawDeliveryMarkdown = await input.ctx.chatText({
      caller: 'human.mouth',
      taskId: readyState.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schemaName: 'human_mouth_markdown',
      temperature: 0.2,
      onTextDelta: input.emitAnswerEvents
        ? (text) => {
            input.ctx.sendEvent({
              type: 'answer_token',
              runId: input.ctx.runId,
              taskId: readyState.task.taskId,
              token: text,
              stage: 'human_mouth'
            })
          }
        : undefined
    })

    const deliveryMarkdown =
      String(rawDeliveryMarkdown || '').trim() ||
      ['# 处理结果', '', readyState.execution.currentDecision?.decision.summary || '任务结束'].join('\n')
    const summary = deriveDeliverySummary({
      deliveryMarkdown,
      state: readyState
    })

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state: readyState,
      summary,
      deliveryMarkdown,
      emitAnswerEvents: input.emitAnswerEvents
    })
  }
}
