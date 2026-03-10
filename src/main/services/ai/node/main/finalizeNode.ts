import type { AiRunContext, AiRunState } from '../../types'
import { buildFinalizePrompt } from '../../prompts/main/finalize'

type FinalizeDecision = {
  mode: 'answer' | 'request_non_local_permission'
  answer: string
  localSourceStatus: 'used' | 'not_used' | 'insufficient'
  localSourceSummary: string
}

const buildFinalAnswer = async (
  ctx: AiRunContext,
  state: AiRunState
): Promise<FinalizeDecision> => {
  if (state.status === 'failed') {
    return {
      mode: 'answer',
      answer: String(state.outputText || state.error || '执行失败。').trim(),
      localSourceStatus: 'not_used',
      localSourceSummary: '本轮未形成有效的本地资料使用结果。'
    }
  }

  if (state.outputText && state.plan.length === 0) {
    return {
      mode: 'answer',
      answer: state.outputText,
      localSourceStatus: 'not_used',
      localSourceSummary: '本轮直接完成，没有额外的本地资料执行链路。'
    }
  }

  const taskSummary = state.plan
    .map((task) =>
      [task.title, task.status, task.resultMessage || task.error || '']
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n')
  const evidenceText = state.contextEvidence.join('\n')
  const prompt = buildFinalizePrompt({
    userInput: state.input,
    selectedScopeSummary: ctx.selectedScopeSummary,
    allowNonLocal: ctx.allowNonLocal,
    hasSelectedLocalSources: Boolean(ctx.selectedSourceScopes && ctx.selectedSourceScopes.length > 0),
    evidenceText,
    taskSummary,
    knownOutput: String(state.outputText || '').trim()
  })

  try {
    const decision = await ctx.chatJson<FinalizeDecision>({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2
    })
    if (decision.answer && decision.localSourceSummary) {
      return decision
    }
  } catch {
    // ignore and fallback
  }

  return {
    mode: 'answer',
    answer: String(state.outputText || '').trim() || '已完成。',
    localSourceStatus: 'not_used',
    localSourceSummary: '本轮未生成可确认的本地资料使用说明。'
  }
}

export const createFinalizeNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const finalized = await buildFinalAnswer(ctx, state)
    const status =
      state.status === 'failed'
        ? 'failed'
        : state.status === 'cancelled'
          ? 'cancelled'
          : 'completed'

    return {
      outputText: finalized.answer,
      localSourceStatus: finalized.localSourceStatus,
      localSourceSummary: finalized.localSourceSummary,
      status,
      mainStage: 'main_finalize'
    }
  }
}
