import { HUMAN_MAX_BRAIN_DECISION_HISTORY } from '../../constants'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { appendHumanTraceStep, emitWatchHint } from '../utils/events'
import { buildBrainPromptContext } from './promptContext'
import { brainDecisionOutputSchema, parseBrainDecisionOutput } from './decisionContract'
import { reduceBrainMemory } from './memoryReducer'
import type { AiRunContextWithHumanOverrides } from '../types'
import { emitLatestHumanStepForState } from '../utils/stateTransitions'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  const ctxWithOverride = input.ctx as AiRunContextWithHumanOverrides

  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const overriddenDecision = ctxWithOverride.resolveBrainDecisionOverride?.()
    const rawOutput = overriddenDecision
      ? overriddenDecision
      : await input.ctx.chatStructured({
          caller: 'human.brain',
          ...buildBrainPromptContext(state),
          schema: brainDecisionOutputSchema,
          schemaName: 'human_brain_decision',
          temperature: 0.1
        })
    const parsedDecision = parseBrainDecisionOutput(rawOutput)
    const reducedMemory = reduceBrainMemory({
      inside: state.brainMemory.inside,
      memoryOps: parsedDecision.memoryOps
    })
    const watchHint = reducedMemory.watchHint
    const nextStage = watchHint
      ? 'brain'
      : parsedDecision.nextAction.action === 'learning'
        ? 'learning'
        : parsedDecision.nextAction.action === 'hand'
          ? 'hand'
          : 'mouth'
    const brainDecisionRecord = {
      ...parsedDecision,
      createdAt: Date.now()
    }
    const traceSteps = appendHumanTraceStep({
      steps: state.trace.steps,
      action: 'brain_decision',
      publicNarrative: parsedDecision.decision.summary,
      resultStatus: 'ok',
      summary: parsedDecision.decision.reason
    })
    const nextState: HumanState = {
      ...state,
      runtime: {
        stage: nextStage,
        status: 'running'
      },
      brainMemory: {
        inside: reducedMemory.inside,
        outside: {
          ...state.brainMemory.outside,
          brainDecisions: [...state.brainMemory.outside.brainDecisions, brainDecisionRecord].slice(
            -HUMAN_MAX_BRAIN_DECISION_HISTORY
          )
        }
      },
      lastBrainDecision: parsedDecision,
      watchHint,
      trace: {
        steps: traceSteps
      }
    }
    emitLatestHumanStepForState({
      ctx: input.ctx,
      cache: input.cache,
      taskId: state.task.taskId,
      state: nextState,
      stage: 'human_brain'
    })
    if (watchHint) {
      emitWatchHint({
        ctx: input.ctx,
        taskId: state.task.taskId,
        source: 'memory_reducer',
        summary: watchHint
      })
    }
    return nextState
  }
}
