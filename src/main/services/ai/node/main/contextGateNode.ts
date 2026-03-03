import type { AiRunContext, AiRunState } from '../../types'
import { appendContextEvidence, contextDecisionSchema, DEFAULT_MAX_CONTEXT_ROUNDS } from './helpers'

export const createMainContextGateNode = (input: {
  ctx: AiRunContext
  maxContextRounds?: number
}) => {
  const { ctx } = input
  const maxContextRounds = Math.max(1, Number(input.maxContextRounds || DEFAULT_MAX_CONTEXT_ROUNDS))

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    // 运行已进入终态时，不再做判定，直接走 finalize 收敛出口。
    if (state.status === 'failed' || state.status === 'cancelled' || state.status === 'completed') {
      return {
        mainStage: 'main_finalize'
      }
    }

    // 上下文补充达到上限后强制降级到 plan，避免 gate/context 死循环。
    if (state.contextRounds >= maxContextRounds) {
      return {
        contextDecision: 'to_plan',
        contextTaskObjective: undefined,
        mainStage: 'main_plan'
      }
    }

    const history = await ctx.loadHistory({
      recentTurns: 12,
      maxRecentTurnsChars: 4000,
      maxSummaryChars: 1000,
      maxLocalInstructionItems: 20,
      maxLocalInstructionChars: 120
    })

    const raw = await ctx.chatJson({
      system: [
        '你是 main_context_gate_node。',
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
    // gate 输出异常时采用保守路径：进入 plan，而不是直接失败。
    if (!parsed.success) {
      return {
        contextDecision: 'to_plan',
        contextTaskObjective: undefined,
        mainStage: 'main_plan'
      }
    }

    const decision = parsed.data
    if (decision.mode === 'need_context') {
      if (state.contextRounds >= maxContextRounds) {
        return {
          contextDecision: 'to_plan',
          contextTaskObjective: undefined,
          mainStage: 'main_plan'
        }
      }
      const contextTaskObjective = String(decision.reason || '').trim() || state.input
      return {
        contextDecision: 'need_context',
        // 把 gate 判定理由转成可执行目标，交给 context_dispatch 调 human。
        contextTaskObjective,
        mainStage: 'main_context_dispatch',
        // 将 gate 的理由写入 evidence，方便后续 plan/finalize 使用。
        contextEvidence: decision.reason
          ? appendContextEvidence(state, `gate: need_context (${decision.reason})`)
          : state.contextEvidence
      }
    }

    if (decision.mode === 'direct_finalize') {
      const answer = String(decision.answer || '').trim()
      return {
        contextDecision: 'direct_finalize',
        contextTaskObjective: undefined,
        directAnswerDraft: answer,
        outputText: answer || state.outputText,
        contextEvidence: decision.reason
          ? appendContextEvidence(state, `gate: direct_finalize (${decision.reason})`)
          : state.contextEvidence,
        mainStage: 'main_finalize'
      }
    }

    return {
      contextDecision: 'to_plan',
      contextTaskObjective: undefined,
      contextEvidence: decision.reason
        ? appendContextEvidence(state, `gate: to_plan (${decision.reason})`)
        : state.contextEvidence,
      mainStage: 'main_plan'
    }
  }
}
