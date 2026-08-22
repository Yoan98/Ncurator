import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { returnToBrainWithDecisionHint } from '../utils/stateTransitions'

export const createFaultNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const pendingFault = state.execution.pendingFault || {
      result: '决策失败，输出中缺少可识别的下一步动作。'
    }
    const issues =
      pendingFault.issues && pendingFault.issues.length > 0
        ? pendingFault.issues
        : [{ path: 'nextAction.action', message: pendingFault.result }]
    const decisionHint = {
      code: 'brain_output_schema_invalid' as const,
      detail: { issues }
    }

    return returnToBrainWithDecisionHint({
      ctx: input.ctx,
      state,
      source: 'brain',
      decisionHint,
      overrides: {
        execution: {
          pendingFault: undefined
        },
        memory: {
          ...state.memory
        }
      }
    })
  }
}
