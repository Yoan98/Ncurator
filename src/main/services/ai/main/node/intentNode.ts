import type { AiRunContext, AiRunState } from '../../types'
import { contextDecisionSchema, DEFAULT_MAX_CONTEXT_ROUNDS } from './helpers'
import { buildIntentPrompt } from '../prompts/intent'

export const createIntentNode = (input: { ctx: AiRunContext; maxContextRounds?: number }) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'completed') {
      return { mainStage: 'main_complete' }
    }

    if (state.contextRounds >= maxContextRounds) {
      return {
        contextObjective: undefined,
        mainStage: 'main_plan'
      }
    }

    const history = await ctx.loadHistory({
      recentTurns: 12,
      maxRecentTurnsChars: 4000,
      maxSummaryChars: 1000
    })

    const prompt = buildIntentPrompt({
      userInput: state.input,
      sessionSummaryText: history.sessionSummaryText,
      recentTurnsText: history.recentTurnsText,
      contextEvidence: state.contextEvidence,
      contextRounds: state.contextRounds,
      maxContextRounds,
      selectedScopeSummary: ctx.selectedScopeSummary
    })

    const decision = await ctx.chatStructured({
      caller: 'main.intent',
      system: prompt.system,
      user: prompt.user,
      schema: contextDecisionSchema,
      schemaName: 'main_intent_decision',
      temperature: 0.1
    })
    if (decision.mode === 'need_context') {
      const contextObjective = String(decision.reason || '').trim() || state.input
      return {
        contextObjective,
        mainStage: 'main_context_human'
      }
    }

    if (decision.mode === 'direct_human') {
      return {
        contextObjective: undefined,
        mainStage: 'main_direct_human_exec'
      }
    }

    return {
      contextObjective: undefined,
      mainStage: 'main_plan'
    }
  }
}
