import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildPlanTaskObjective } from './objectives'
import { buildPlanExecPatch, pickPendingTaskIndex } from './helpers'
import { runDirectorHumanSubtask } from './humanDispatch'

export const createPlanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    // 按 cursor 串行选择 ready task；无任务时进入 synthesis。
    const taskIndex = pickPendingTaskIndex(state.plan, state.dispatchCursor)
    if (taskIndex < 0) {
      return {
        directorStage: 'director_synthesis_human'
      }
    }

    const task = state.plan[taskIndex]
    const taskUserInput = buildPlanTaskObjective({
      userInput: state.input,
      task,
      selectedScopeSummary: ctx.selectedScopeSummary,
      contextEvidence: state.contextEvidence,
      priorDeliveries: state.plan.slice(0, taskIndex).filter((item) => Boolean(item.deliveryMarkdown))
    })
    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: task.id,
      stage: 'director_plan_exec',
      userInput: taskUserInput,
      runHumanTask,
      options: {
        deliveryMode: 'task_handoff'
      }
    })

    return buildPlanExecPatch({
      plan: state.plan,
      taskIndex,
      output
    })
  }
}
