import type { AiRunContext } from '../../../types'
import type { HumanDeliveryMode, HumanRuntimeCache, HumanState } from '../../types'
import { buildFallbackDeliveryMarkdown } from './deliveryMarkdown'
import { buildMouthPromptContext } from './promptContext'
import { mouthResultSchema } from './contract'
import type { AiRunContextWithHumanOverrides } from '../types'
import { completeHumanTask } from '../utils/stateTransitions'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  deliveryMode: HumanDeliveryMode
  streamAnswer: boolean
  internalDelivery: boolean
}) => {
  const ctxWithOverride = input.ctx as AiRunContextWithHumanOverrides

  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const finalStatus =
      state.lastBrainDecision?.nextAction.action === 'mouth' &&
      state.lastBrainDecision.nextAction.status === 'completed'
        ? 'completed'
        : 'blocked'
    const override = ctxWithOverride.resolveHumanDeliveryOverride?.({
      userInput: state.task.userInput,
      deliveryMode: input.deliveryMode,
      status: finalStatus,
      summary: state.lastBrainDecision?.decision.summary || '任务结束',
      state
    })

    let result = override
    if (!result) {
      const prompt = buildMouthPromptContext({
        state,
        deliveryMode: input.deliveryMode,
        finalStatus
      })
      result = await input.ctx.chatStructured({
        caller: 'human.mouth',
        system: prompt.system,
        user: prompt.user,
        schema: mouthResultSchema,
        schemaName: 'human_mouth_result',
        temperature: 0.2
      })
    }

    const summary = String(result.summary || '').trim() || '任务结束'
    const deliveryMarkdown =
      String(result.deliveryMarkdown || '').trim() ||
      buildFallbackDeliveryMarkdown({
        state,
        deliveryMode: input.deliveryMode,
        finalStatus,
        summary
      })

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state,
      finalStatus,
      summary,
      deliveryMarkdown,
      streamAnswer: input.streamAnswer,
      internalDelivery: input.internalDelivery
    })
  }
}
