import type { AiRunContext } from '../../../types'
import type { HumanDeliveryMode, HumanRuntimeCache, HumanState } from '../../types'
import { buildMouthPromptContext } from '../../prompts/mouth'
import { completeHumanTask } from '../utils/stateTransitions'
import { buildDeliveryModeFallbackMarkdown } from '../../shared/deliveryContracts'
import { deriveDeliverySummary } from '../../shared/deliverySummary'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  deliveryMode: HumanDeliveryMode
  emitAnswerEvents: boolean
  internalDelivery: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const prompt = buildMouthPromptContext({
      state,
      deliveryMode: input.deliveryMode
    })
    const rawDeliveryMarkdown = await input.ctx.chatText({
      caller: 'human.mouth',
      taskId: state.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schemaName: 'human_mouth_markdown',
      temperature: 0.2,
      onTextDelta: input.emitAnswerEvents
        ? (text) => {
            input.ctx.sendEvent({
              type: 'answer_token',
              runId: input.ctx.runId,
              taskId: state.task.taskId,
              token: text,
              stage: 'human_mouth'
            })
          }
        : undefined
    })

    const deliveryMarkdown =
      String(rawDeliveryMarkdown || '').trim() ||
      buildDeliveryModeFallbackMarkdown({
        state,
        mode: input.deliveryMode,
        summary: state.lastBrainDecision?.decision.summary || '任务结束'
      })
    const summary = deriveDeliverySummary({
      deliveryMarkdown,
      state
    })

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state,
      summary,
      deliveryMarkdown,
      emitAnswerEvents: input.emitAnswerEvents,
      internalDelivery: input.internalDelivery
    })
  }
}
