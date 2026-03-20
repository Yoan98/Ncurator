import { HUMAN_MAX_BRAIN_DECISION_HISTORY } from '../../constants'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { appendHumanTraceStep, emitHumanStep, emitWatchHint } from '../utils/events'
import { getAvailableToolNames } from '../learningNode/skillLoader'
import { buildBrainPromptContext } from './promptContext'
import { parseBrainDecisionOutput } from './decisionContract'
import { reduceBrainMemory } from './memoryReducer'
import type { AiRunContextWithBrainOverride } from './types'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  const ctxWithOverride = input.ctx as AiRunContextWithBrainOverride

  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const overriddenDecision = ctxWithOverride.resolveBrainDecisionOverride?.()
    const rawOutput = overriddenDecision
      ? overriddenDecision
      : await input.ctx.chatJson({
          ...buildBrainPromptContext(state),
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
        stage: 'human_brain'
      })
    }
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
