import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildDirectHumanObjective } from './objectives'
import { createDirectorHumanDispatchNode } from './humanDispatch'

const DIRECT_TASK_ID = 'direct-human'

export const createDirectHumanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) =>
  createDirectorHumanDispatchNode({
    ...input,
    prepare: (state: AiRunState) => ({
      taskId: DIRECT_TASK_ID,
      stage: 'director_direct_human_exec',
      userInput: buildDirectHumanObjective({
        userInput: state.input,
        contextEvidence: state.contextEvidence
      }),
      options: {
        deliveryMode: 'user_answer',
        streamAnswer: true
      },
      buildPatch: (output) => ({
        finalDeliveryMarkdown: output.deliveryMarkdown,
        finalArtifacts: output.artifacts || [],
        directorStage: 'director_complete'
      })
    })
  })
