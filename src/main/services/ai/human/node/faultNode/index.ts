import type { AiRunContext } from '../../../types'
import { appendDecisionRound, appendRoundRecord, buildFaultExecution } from '../../memory/rounds'
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
    const execution = buildFaultExecution({
      result: pendingFault.result,
      decisionHint
    })
    const taskRun = state.execution.currentThought
      ? appendDecisionRound({ state, execution })
      : appendRoundRecord({
          state,
          thought: { next: '本轮决策未能进入可执行节点。' },
          nextAction: { action: 'fault' },
          execution
        })

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
          ...state.memory,
          taskRun
        }
      }
    })
  }
}
