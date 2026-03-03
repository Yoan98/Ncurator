import type { HumanTaskInput, JsonObject } from '../../../../../shared/types'
import type { AiRunContext, AiRunState } from '../../types'
import { appendContextEvidence } from './helpers'

export const createMainContextDispatchNode = (input: {
  ctx: AiRunContext
  runHumanTask: (taskInput: HumanTaskInput) => Promise<import('../../../../../shared/types').HumanTaskOutput>
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const contextTaskId = `context-${state.contextRounds + 1}`
    const slotState = state.taskSlots[contextTaskId]
    const objective = String(state.contextTaskObjective || '').trim() || state.input

    // 上下文补充也走 human 子图，保持与 dispatch 一致的执行语义。
    const output = await runHumanTask({
      runId: state.runId,
      sessionId: state.sessionId,
      mode: 'context',
      taskId: contextTaskId,
      title: 'Context Enrichment',
      objective,
      selectedDocumentIds: ctx.selectedDocumentIds,
      workspace: ctx.workspace,
      slotState: slotState && typeof slotState === 'object' ? (slotState as JsonObject) : {},
      slotArtifacts: state.slotArtifacts
    })

    return {
      contextRounds: state.contextRounds + 1,
      // context task 的摘要会作为下一轮 gate/plan 的证据输入。
      contextEvidence: appendContextEvidence(state, output.summary),
      taskSlots: {
        ...state.taskSlots,
        [contextTaskId]: output.slotState
      },
      slotArtifacts: output.slotArtifacts,
      humanStepIndex: output.steps,
      contextTaskObjective: undefined,
      mainStage: 'main_context_gate'
    }
  }
}
