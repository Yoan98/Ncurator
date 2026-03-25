import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { extractContextNoteReusableEvidence } from '../../human/shared/deliveryContracts'
import { appendContextEvidence } from './helpers'
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
      buildPatch: (output) => {
        const reusableEvidence = extractContextNoteReusableEvidence(output.deliveryMarkdown)
        const nextContextEvidence =
          reusableEvidence.length > 0
            ? reusableEvidence.reduce(
                (evidences, item) =>
                  appendContextEvidence({ ...state, contextEvidence: evidences }, item),
                state.contextEvidence
              )
            : state.contextEvidence

        return {
          contextRounds: state.contextRounds + 1,
          contextEvidence: nextContextEvidence,
          contextObjective: undefined,
          directorStage: 'director_intent'
        }
      }
    })
  })
