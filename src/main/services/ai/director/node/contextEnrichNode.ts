import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildContextEnrichPatch } from './helpers'
import { buildContextHumanObjective } from './objectives'
import { createDirectorHumanDispatchNode } from './humanDispatch'

export const createContextEnrichNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) =>
  createDirectorHumanDispatchNode({
    ...input,
    prepare: (state: AiRunState) => ({
      taskId: `context-${state.contextRounds + 1}`,
      stage: 'director_context_human',
      userInput: buildContextHumanObjective({
        userInput: state.input,
        contextObjective: String(state.contextObjective || '').trim() || state.input,
        contextEvidence: state.contextEvidence
      }),
      options: {
        deliveryMode: 'context_note',
        internalDelivery: true
      },
      buildPatch: (output) =>
        buildContextEnrichPatch({
          state,
          output
        })
    })
  })
