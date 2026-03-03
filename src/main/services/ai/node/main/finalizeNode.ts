import type { AiRunContext, AiRunState } from '../../types'
import { buildFinalAnswer } from './helpers'

export const createMainFinalizeNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    // final answer 只在该节点统一生成，避免多处输出导致事件语义分裂。
    const outputText = await buildFinalAnswer(ctx, state)
    const status = state.status === 'failed' ? 'failed' : state.status === 'cancelled' ? 'cancelled' : 'completed'

    return {
      outputText,
      status,
      mainStage: 'main_finalize'
    }
  }
}
