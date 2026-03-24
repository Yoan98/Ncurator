import type { WatchHintSource } from '../../../../../../shared/types'
import { HUMAN_MAX_BRAIN_DECISION_HISTORY } from '../../constants'
import type { AiRunContext } from '../../../types'
import type { HumanResult, HumanRuntimeCache, HumanState, LastBrainDecision } from '../../types'
import { getAvailableToolNames } from '../learningNode/skillLoader'
import { appendHumanTraceStep, appendHumanTraceSteps, emitHumanStep, emitTaskDelivery, emitWatchHint } from './events'

export type HumanEventStage = 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'

export const returnToBrain = (
  state: HumanState,
  overrides: Partial<Omit<HumanState, 'runtime'>> & {
    runtime?: Partial<HumanState['runtime']>
  } = {}
): HumanState => ({
  ...state,
  ...overrides,
  runtime: {
    ...state.runtime,
    ...overrides.runtime,
    stage: 'brain'
  }
})

export const returnToBrainWithWatchHint = (input: {
  ctx: AiRunContext
  state: HumanState
  source: WatchHintSource
  watchHint: string
  overrides?: Partial<Omit<HumanState, 'runtime' | 'watchHint'>> & {
    runtime?: Partial<HumanState['runtime']>
  }
}): HumanState => {
  emitWatchHint({
    ctx: input.ctx,
    taskId: input.state.task.taskId,
    source: input.source,
    summary: input.watchHint
  })
  return returnToBrain(input.state, {
    ...input.overrides,
    watchHint: input.watchHint
  })
}

const buildStepToolContext = (input: {
  cache: HumanRuntimeCache
  state: HumanState
}) => ({
  learnedSkillIds: input.state.brainMemory.outside.learnedSkillIds,
  availableToolNames: getAvailableToolNames({
    learnedSkillIds: input.state.brainMemory.outside.learnedSkillIds,
    cache: input.cache
  })
})

export const emitLatestHumanStepForState = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  state: HumanState
  stage: HumanEventStage
}) => {
  const step = input.state.trace.steps.at(-1)
  if (!step) return

  const toolContext = buildStepToolContext({
    cache: input.cache,
    state: input.state
  })
  emitHumanStep({
    ctx: input.ctx,
    taskId: input.taskId,
    step,
    learnedSkillIds: toolContext.learnedSkillIds,
    availableToolNames: toolContext.availableToolNames,
    stage: input.stage
  })
}

export const emitTailHumanStepsForState = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  taskId: string
  state: HumanState
  count: number
  stage: HumanEventStage
}) => {
  if (input.count <= 0) return
  const toolContext = buildStepToolContext({
    cache: input.cache,
    state: input.state
  })
  input.state.trace.steps.slice(-input.count).forEach((step) => {
    emitHumanStep({
      ctx: input.ctx,
      taskId: input.taskId,
      step,
      learnedSkillIds: toolContext.learnedSkillIds,
      availableToolNames: toolContext.availableToolNames,
      stage: input.stage
    })
  })
}

export const returnToBrainAfterTrace = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  source: WatchHintSource
  traceItems: Array<{
    action: HumanState['trace']['steps'][number]['action']
    publicNarrative: string
    resultStatus?: HumanState['trace']['steps'][number]['resultStatus']
    skillId?: HumanState['trace']['steps'][number]['skillId']
    toolName?: HumanState['trace']['steps'][number]['toolName']
    summary: string
  }>
  stage: 'human_learning' | 'human_hand'
  watchHint?: string
  overrides?: Partial<Omit<HumanState, 'runtime' | 'watchHint' | 'trace'>> & {
    runtime?: Partial<HumanState['runtime']>
  }
}): HumanState => {
  const traceSteps = appendHumanTraceSteps({
    steps: input.state.trace.steps,
    items: input.traceItems
  })
  const nextState = input.watchHint
    ? returnToBrainWithWatchHint({
        ctx: input.ctx,
        state: input.state,
        source: input.source,
        watchHint: input.watchHint,
        overrides: {
          ...input.overrides,
          trace: {
            steps: traceSteps
          }
        }
      })
    : returnToBrain(input.state, {
        ...input.overrides,
        watchHint: undefined,
        trace: {
          steps: traceSteps
        }
      })

  emitTailHumanStepsForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    count: input.traceItems.length,
    stage: input.stage
  })
  return nextState
}

const resolveBrainNextStage = (input: {
  watchHint?: string
  decision: LastBrainDecision
}): HumanState['runtime']['stage'] => {
  if (input.watchHint) return 'brain'
  return input.decision.nextAction.action === 'learning'
    ? 'learning'
    : input.decision.nextAction.action === 'hand'
      ? 'hand'
      : 'mouth'
}

export const applyBrainDecisionTransition = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  decision: LastBrainDecision
  reducedInside: HumanState['brainMemory']['inside']
  watchHint?: string
}): HumanState => {
  const nextState: HumanState = {
    ...input.state,
    runtime: {
      stage: resolveBrainNextStage({
        watchHint: input.watchHint,
        decision: input.decision
      }),
      status: 'running'
    },
    brainMemory: {
      inside: input.reducedInside,
      outside: {
        ...input.state.brainMemory.outside,
        brainDecisions: [
          ...input.state.brainMemory.outside.brainDecisions,
          {
            ...input.decision,
            createdAt: Date.now()
          }
        ].slice(-HUMAN_MAX_BRAIN_DECISION_HISTORY)
      }
    },
    lastBrainDecision: input.decision,
    watchHint: input.watchHint,
    trace: {
      steps: appendHumanTraceStep({
        steps: input.state.trace.steps,
        action: 'brain_decision',
        publicNarrative: input.decision.decision.summary,
        resultStatus: 'ok',
        summary: input.decision.decision.reason
      })
    }
  }

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_brain'
  })

  if (input.watchHint) {
    emitWatchHint({
      ctx: input.ctx,
      taskId: input.state.task.taskId,
      source: 'memory_reducer',
      summary: input.watchHint
    })
  }

  return nextState
}

export const completeHumanTask = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  finalStatus: 'completed' | 'blocked'
  summary: string
  deliveryMarkdown: string
  streamAnswer: boolean
  internalDelivery: boolean
}): HumanState => {
  const finalResult: HumanResult = {
    status: input.finalStatus,
    summary: input.summary,
    deliveryMarkdown: input.deliveryMarkdown,
    artifacts: input.state.runtimeArtifacts.length > 0 ? [...input.state.runtimeArtifacts] : undefined
  }

  if (input.streamAnswer) {
    input.ctx.sendEvent({
      type: 'answer_completed',
      runId: input.ctx.runId,
      taskId: input.state.task.taskId,
      text: input.deliveryMarkdown,
      stage: 'human_mouth'
    })
  }

  emitTaskDelivery({
    ctx: input.ctx,
    taskId: input.state.task.taskId,
    summary: finalResult.summary,
    deliveryMarkdown: input.deliveryMarkdown,
    internal: input.internalDelivery
  })

  const nextState: HumanState = {
    ...input.state,
    runtime: {
      stage: 'mouth',
      status: input.finalStatus
    },
    result: finalResult,
    trace: {
      steps: appendHumanTraceStep({
        steps: input.state.trace.steps,
        action: input.finalStatus === 'completed' ? 'deliver_result' : 'block_result',
        publicNarrative: finalResult.summary,
        resultStatus: input.finalStatus === 'completed' ? 'ok' : 'blocked',
        summary: finalResult.summary
      })
    }
  }

  emitLatestHumanStepForState({
    ctx: input.ctx,
    cache: input.cache,
    taskId: input.state.task.taskId,
    state: nextState,
    stage: 'human_mouth'
  })

  return nextState
}
