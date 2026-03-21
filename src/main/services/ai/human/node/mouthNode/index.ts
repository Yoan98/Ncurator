import type { AiRunContext } from '../../../types'
import type { HumanDeliveryMode, HumanRuntimeCache, HumanState } from '../../types'
import { appendHumanTraceStep, emitHumanStep, emitTaskDelivery } from '../utils/events'
import { getAvailableToolNames } from '../learningNode/skillLoader'
import { buildFallbackDeliveryMarkdown } from './deliveryMarkdown'
import { buildMouthPromptContext } from './promptContext'
import { mouthResultSchema } from './contract'
import type { AiRunContextWithMouthOverride } from './types'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  deliveryMode: HumanDeliveryMode
  streamAnswer: boolean
  internalDelivery: boolean
}) => {
  const ctxWithOverride = input.ctx as AiRunContextWithMouthOverride

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

    const finalResult = {
      status: finalStatus,
      summary: result.summary,
      deliveryMarkdown:
        String(result.deliveryMarkdown || '').trim() ||
        buildFallbackDeliveryMarkdown({
          state,
          deliveryMode: input.deliveryMode,
          finalStatus,
          summary: result.summary
        }),
      artifacts: state.runtimeArtifacts.length > 0 ? [...state.runtimeArtifacts] : undefined
    }
    if (input.streamAnswer) {
      input.ctx.sendEvent({
        type: 'answer_completed',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        text: finalResult.deliveryMarkdown,
        stage: 'human_mouth'
      })
    }
    emitTaskDelivery({
      ctx: input.ctx,
      taskId: state.task.taskId,
      summary: finalResult.summary,
      deliveryMarkdown: finalResult.deliveryMarkdown,
      internal: input.internalDelivery
    })
    const traceSteps = appendHumanTraceStep({
      steps: state.trace.steps,
      action: finalStatus === 'completed' ? 'deliver_result' : 'block_result',
      publicNarrative: finalResult.summary,
      resultStatus: finalStatus === 'completed' ? 'ok' : 'blocked',
      summary: finalResult.summary
    })
    const nextState: HumanState = {
      ...state,
      runtime: {
        stage: 'mouth',
        status: finalStatus
      },
      result: finalResult,
      trace: {
        steps: traceSteps
      }
    }
    const step = nextState.trace.steps.at(-1)
    if (step) {
      emitHumanStep({
        ctx: input.ctx,
        taskId: state.task.taskId,
        step,
        learnedSkillIds: nextState.brainMemory.outside.learnedSkillIds,
        availableToolNames: getAvailableToolNames({
          learnedSkillIds: nextState.brainMemory.outside.learnedSkillIds,
          cache: input.cache
        }),
        stage: 'human_mouth'
      })
    }
    return nextState
  }
}
