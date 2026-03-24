import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildSynthesisHumanPatch } from './helpers'
import { buildSynthesisHumanObjective } from './objectives'
import { createDirectorHumanDispatchNode } from './humanDispatch'

const SYNTHESIS_TASK_ID = 'synthesis-human'

export const createSynthesisHumanNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) =>
  createDirectorHumanDispatchNode({
    ...input,
    prepare: (state: AiRunState) => ({
      taskId: SYNTHESIS_TASK_ID,
      stage: 'director_synthesis_human',
      userInput: buildSynthesisHumanObjective({
        userInput: state.input,
        selectedScopeSummary: input.ctx.selectedScopeSummary,
        contextEvidence: state.contextEvidence,
        plan: state.plan
      }),
      options: {
        deliveryMode: 'user_answer',
        streamAnswer: true
      },
      buildPatch: (output) =>
        buildSynthesisHumanPatch({
          state,
          output
        })
    })
  })
