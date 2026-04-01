import type { AiRunContext } from '../../../types'
import { mouthOutputSchema } from '../../schema'
import type { HumanDeliveryMode, HumanRuntimeCache, HumanState } from '../../types'
import { buildMouthPromptContext } from '../../prompts/mouth'
import { completeHumanTask } from '../utils/stateTransitions'
import { buildDeliveryModeFallbackMarkdown } from '../../shared/deliveryContracts'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  deliveryMode: HumanDeliveryMode
  streamAnswer: boolean
  internalDelivery: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const prompt = buildMouthPromptContext({
      state,
      deliveryMode: input.deliveryMode
    })
    const result = await input.ctx.chatStructured({
      caller: 'human.mouth',
      system: prompt.system,
      user: prompt.user,
      schema: mouthOutputSchema,
      schemaName: 'human_mouth_result',
      temperature: 0.2
    })

    const summary = String(result.summary || '').trim() || '任务结束'
    const deliveryMarkdown =
      String(result.deliveryMarkdown || '').trim() ||
      buildDeliveryModeFallbackMarkdown({
        state,
        mode: input.deliveryMode,
        summary
      })

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state,
      summary,
      deliveryMarkdown,
      streamAnswer: input.streamAnswer,
      internalDelivery: input.internalDelivery
    })
  }
}
