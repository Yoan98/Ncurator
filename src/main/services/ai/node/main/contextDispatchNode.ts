import type { HumanTaskInput } from '../../../../../shared/types'
import type { AiRunContext, AiRunState } from '../../types'
import { appendContextEvidence } from './helpers'

export const createMainContextDispatchNode = (input: {
  ctx: AiRunContext
  runHumanTask: (taskInput: HumanTaskInput) => Promise<import('../../../../../shared/types').HumanTaskOutput>
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const contextTaskId = `context-${state.contextRounds + 1}`
    const objective = String(state.contextObjective || '').trim() || state.input

    const output = await runHumanTask({
      mode: 'context',
      taskId: contextTaskId,
      objective,
      kindHint: 'local_kb_retrieval'
    })

    return {
      contextRounds: state.contextRounds + 1,
      contextEvidence: appendContextEvidence(state, output.summary),
      contextObjective: undefined,
      mainStage: 'main_intent'
    }
  }
}
