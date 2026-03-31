import type { AiRunState, DirectorNodeContext } from '../../types'
import { contextDecisionSchema, DEFAULT_MAX_CONTEXT_ROUNDS, loadDirectorHistory } from './helpers'
import { buildIntentPrompt } from '../prompts/intent'

export const createIntentNode = (input: { ctx: DirectorNodeContext; maxContextRounds?: number }) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'completed') {
      return { directorStage: 'director_complete' }
    }

    if (state.contextRounds >= maxContextRounds) {
      return {
        contextObjective: undefined,
        directorStage: 'director_plan'
      }
    }

    const history = await loadDirectorHistory(ctx)

    const prompt = buildIntentPrompt({
      userInput: state.input,
      sessionSummaryText: history.sessionSummaryText,
      recentTurnsText: history.recentTurnsText,
      contextEvidence: state.contextEvidence,
      contextRounds: state.contextRounds,
      maxContextRounds,
      selectedContextText: ctx.selectedContextText
    })

    const decision = await ctx.chatStructured({
      caller: 'director.intent',
      system: prompt.system,
      user: prompt.user,
      schema: contextDecisionSchema,
      schemaName: 'director_intent_decision',
      temperature: 0.1
    })
    if (decision.mode === 'need_context') {
      const contextObjective = String(decision.reason || '').trim() || state.input
      return {
        contextObjective,
        directorStage: 'director_context_human'
      }
    }

    if (decision.mode === 'direct_human') {
      return {
        contextObjective: undefined,
        directorStage: 'director_direct_human_exec'
      }
    }

    return {
      contextObjective: undefined,
      directorStage: 'director_plan'
    }
  }
}
