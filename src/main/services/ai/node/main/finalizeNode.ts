import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../../llm/chatModel'
import { getMessageText } from '../../../../utils/aiCapabilityUtils'
import type { AiRunContext, AiRunState } from '../../types'

const buildFinalAnswer = async (ctx: AiRunContext, state: AiRunState): Promise<string> => {
  if (state.status === 'failed') {
    return String(state.outputText || state.error || '执行失败。').trim()
  }

  if (state.outputText && state.plan.length === 0) {
    return state.outputText
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

  try {
    const cfg = await ctx.getModelConfig()
    const model = createChatModel(cfg, { temperature: 0.2 })
    const res = await model.invoke([
      new SystemMessage('你是 main graph 的 finalize 节点。请给出最终答复。'),
      new HumanMessage(
        [
          `用户输入:\n${state.input}`,
          `上下文证据:\n${evidenceText || '(none)'}`,
          `任务执行摘要:\n${taskSummary || '(none)'}`,
          `已知输出:\n${String(state.outputText || '').trim() || '(none)'}`,
          '请输出简洁、可执行、中文最终答复。'
        ].join('\n\n')
      )
    ])
    const text = getMessageText(res.content).trim()
    if (text) return text
  } catch {
    // ignore and fallback
  }

  return String(state.outputText || '').trim() || '已完成。'
}

export const createFinalizeNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const outputText = await buildFinalAnswer(ctx, state)
    const status =
      state.status === 'failed'
        ? 'failed'
        : state.status === 'cancelled'
          ? 'cancelled'
          : 'completed'

    return {
      outputText,
      status,
      mainStage: 'main_finalize'
    }
  }
}
