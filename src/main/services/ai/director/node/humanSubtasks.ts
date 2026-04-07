import type { AiRunState, DirectorNodeContext, HumanRunDispatchOptions, HumanTaskOutput, HumanTaskRunner } from '../../types'
import { mergeArtifactRefs } from '../../utils/artifacts'
import { extractContextNoteReusableEvidence } from '../../human/shared/deliveryContracts'
import { appendContextEvidence } from './helpers'
import {
  buildContextHumanObjective,
  buildDirectHumanObjective,
  buildSynthesisHumanObjective
} from './objectives'

type DirectorHumanDispatchStage =
  | 'director_context_human'
  | 'director_plan_exec'
  | 'director_direct_human_exec'
  | 'director_synthesis_human'

const DIRECT_TASK_ID = 'direct-human'
const SYNTHESIS_TASK_ID = 'synthesis-human'

export const runDirectorHumanSubtask = async (input: {
  ctx: DirectorNodeContext
  runId: string
  taskId: string
  stage: DirectorHumanDispatchStage
  userInput: string
  runHumanTask: HumanTaskRunner
  options: HumanRunDispatchOptions
}): Promise<HumanTaskOutput> => {
  input.ctx.checkCancelled()

  input.ctx.sendEvent({
    type: 'task_started',
    runId: input.runId,
    taskId: input.taskId,
    stage: input.stage
  })

  const output = await input.runHumanTask(
    {
      taskId: input.taskId,
      userInput: input.userInput
    },
    input.options
  )

  input.ctx.sendEvent({
    type: 'task_completed',
    runId: input.runId,
    taskId: input.taskId,
    stage: input.stage
  })

  return output
}

const mergeReusableEvidence = (input: {
  state: AiRunState
  output: HumanTaskOutput
}): string[] => {
  const reusableEvidence = extractContextNoteReusableEvidence(input.output.deliveryMarkdown)
  const fallbackSummary = String(input.output.summary || '').trim()
  const candidateEvidence =
    reusableEvidence.length > 0 ? reusableEvidence : fallbackSummary ? [fallbackSummary] : []
  if (candidateEvidence.length === 0) return input.state.contextEvidence

  return candidateEvidence.reduce(
    (evidences, item) =>
      appendContextEvidence({ ...input.state, contextEvidence: evidences }, item),
    input.state.contextEvidence
  )
}

export const createContextEnrichNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: `context-${state.contextRounds + 1}`,
      stage: 'director_context_human',
      userInput: buildContextHumanObjective({
        userInput: state.input,
        contextObjective: String(state.contextObjective || '').trim() || state.input,
        contextEvidence: state.contextEvidence
      }),
      runHumanTask,
      options: {
        deliveryMode: 'context_note',
        internalDelivery: true
      }
    })

    return {
      contextRounds: state.contextRounds + 1,
      contextEvidence: mergeReusableEvidence({
        state,
        output
      }),
      contextObjective: undefined,
      directorStage: 'director_intent'
    }
  }
}

export const createDirectHumanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: DIRECT_TASK_ID,
      stage: 'director_direct_human_exec',
      userInput: buildDirectHumanObjective({
        userInput: state.input,
        contextEvidence: state.contextEvidence
      }),
      runHumanTask,
      options: {
        deliveryMode: 'user_answer',
        streamAnswer: true
      }
    })

    return {
      finalDeliveryMarkdown: output.deliveryMarkdown,
      finalArtifacts: output.artifacts || [],
      directorStage: 'director_complete'
    }
  }
}

export const createSynthesisHumanNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: SYNTHESIS_TASK_ID,
      stage: 'director_synthesis_human',
      userInput: buildSynthesisHumanObjective({
        userInput: state.input,
        referenceScope: ctx.referenceScope,
        contextEvidence: state.contextEvidence,
        plan: state.plan
      }),
      runHumanTask,
      options: {
        deliveryMode: 'user_answer',
        streamAnswer: true
      }
    })

    return {
      finalDeliveryMarkdown: output.deliveryMarkdown,
      finalArtifacts: mergeArtifactRefs(...state.plan.map((task) => task.artifacts), output.artifacts),
      directorStage: 'director_complete'
    }
  }
}
