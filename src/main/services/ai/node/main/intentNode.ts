import type { AiRunContext, AiRunState } from '../../types'
import { appendContextEvidence, contextDecisionSchema, DEFAULT_MAX_CONTEXT_ROUNDS } from './helpers'

export const createMainIntentNode = (input: {
  ctx: AiRunContext
  maxContextRounds?: number
}) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'completed') {
      return { mainStage: 'main_finalize' }
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

    const raw = await ctx.chatJson({
      system: [
        '你是 main_intent_node。',
        '你要在三种模式中选择一种：need_context / to_plan / direct_finalize。',
        '只输出 JSON，格式: {"mode":"...","reason":"...","answer":"..."}。',
        '当 mode=direct_finalize 时，必须提供 answer。'
      ].join('\n'),
      user: [
        `用户输入:\n${state.input}`,
        `会话摘要:\n${history.sessionSummaryText || '(none)'}`,
        `最近对话:\n${history.recentTurnsText || '(none)'}`,
        `上下文证据:\n${state.contextEvidence.join('\n') || '(none)'}`,
        `当前 context rounds: ${state.contextRounds}/${maxContextRounds}`
      ].join('\n\n'),
      temperature: 0.1
    })

    const parsed = contextDecisionSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        contextObjective: undefined,
        mainStage: 'main_plan'
      }
    }

    const decision = parsed.data
    if (decision.mode === 'need_context') {
      const contextObjective = String(decision.reason || '').trim() || state.input
      return {
        contextObjective,
        mainStage: 'main_context_enrich',
        contextEvidence: decision.reason
          ? appendContextEvidence(state, `intent: need_context (${decision.reason})`)
          : state.contextEvidence
      }
    }

    if (decision.mode === 'direct_finalize') {
      const answer = String(decision.answer || '').trim()
      return {
        contextObjective: undefined,
        outputText: answer || state.outputText,
        contextEvidence: decision.reason
          ? appendContextEvidence(state, `intent: direct_finalize (${decision.reason})`)
          : state.contextEvidence,
        mainStage: 'main_finalize'
      }
    }

    return {
      contextObjective: undefined,
      contextEvidence: decision.reason
        ? appendContextEvidence(state, `intent: to_plan (${decision.reason})`)
        : state.contextEvidence,
      mainStage: 'main_plan'
    }
  }
}
