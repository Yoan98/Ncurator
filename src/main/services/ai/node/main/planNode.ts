import type { AiRunContext, AiRunState } from '../../types'
import { planDecisionSchema, toPlanTasks, validatePlannerTasks } from './helpers'
import { buildPlanPrompt } from '../../prompts/main/plan'

export const createPlanNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const history = await ctx.loadHistory({
      recentTurns: 12,
      maxRecentTurnsChars: 4000,
      maxSummaryChars: 1000
    })

    const prompt = buildPlanPrompt({
      userInput: state.input,
      sessionSummaryText: history.sessionSummaryText,
      recentTurnsText: history.recentTurnsText,
      contextEvidence: state.contextEvidence,
      selectedScopeSummary: ctx.selectedScopeSummary
    })

    const raw = await ctx.chatJson({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.1
    })

    const parsed = planDecisionSchema.safeParse(raw)
    if (!parsed.success) {
      const parseReason = parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
          return `${path}: ${issue.message}`
        })
        .join('; ')

      return {
        status: 'failed',
        error: `plan_generation_failed: ${parseReason || 'invalid planner output'}`,
        mainStage: 'main_complete'
      }
    }

    const validationError = validatePlannerTasks(parsed.data.tasks)
    if (validationError) {
      return {
        status: 'failed',
        error: `plan_generation_failed: ${validationError}`,
        mainStage: 'main_complete'
      }
    }

    const plan = toPlanTasks(parsed.data.tasks)

    ctx.sendEvent({
      type: 'plan_created',
      runId: state.runId,
      plan,
      stage: 'main_plan'
    })

    return {
      plan,
      dispatchCursor: 0,
      mainStage: 'main_plan_exec'
    }
  }
}
