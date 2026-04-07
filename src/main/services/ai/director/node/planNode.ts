import type { AiRunState, DirectorNodeContext } from '../../types'
import { loadDirectorHistory, planDecisionSchema, toPlanTasks, validatePlannerTasks } from './helpers'
import { buildPlanPrompt } from '../prompts/plan'

export const createPlanNode = (input: { ctx: DirectorNodeContext }) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const history = await loadDirectorHistory(ctx)

    const prompt = buildPlanPrompt({
      userInput: state.input,
      sessionSummaryText: history.sessionSummaryText,
      recentTurnsText: history.recentTurnsText,
      contextEvidence: state.contextEvidence,
      referenceScope: ctx.referenceScope
    })

    const decision = await ctx.chatStructured({
      caller: 'director.plan',
      system: prompt.system,
      user: prompt.user,
      schema: planDecisionSchema,
      schemaName: 'director_plan_decision',
      temperature: 0.1
    })

    const validationError = validatePlannerTasks(decision.tasks)
    if (validationError) {
      return {
        status: 'failed',
        error: `plan_generation_failed: ${validationError}`,
        directorStage: 'director_complete'
      }
    }

    const plan = toPlanTasks(decision.tasks)

    ctx.sendEvent({
      type: 'plan_created',
      runId: state.runId,
      plan,
      stage: 'director_plan'
    })

    return {
      plan,
      dispatchCursor: 0,
      directorStage: 'director_plan_exec'
    }
  }
}
