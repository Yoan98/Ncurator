import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { buildPlanTaskObjective } from './objectives'
import { pickPendingTaskIndex } from './helpers'
import { runDirectorHumanSubtask } from './humanDispatch'

export const createPlanExecNode = (input: {
  ctx: AiRunContext
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
    const runningPlan = state.plan.map((item, index) =>
      index === taskIndex ? { ...item, status: 'running' as const } : item
    )

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

    // 当前策略为 stop-dispatch：单任务 blocked 会停止后续业务任务，但保留 synthesis 收口。
    const blocked = output.status === 'blocked'

    const nextPlan = runningPlan.map((item, index) => {
      if (index !== taskIndex) return item
      if (blocked) {
        return {
          ...item,
          status: 'blocked' as const,
          deliveryMarkdown: output.deliveryMarkdown,
          artifacts: output.artifacts
        }
      }
      return {
        ...item,
        status: 'completed' as const,
        deliveryMarkdown: output.deliveryMarkdown,
        artifacts: output.artifacts
      }
    })

    const hasPending = nextPlan.some((item) => item.status === 'ready')

    return {
      plan: nextPlan,
      dispatchCursor: taskIndex + 1,
      directorStage: blocked ? 'director_synthesis_human' : hasPending ? 'director_plan_exec' : 'director_synthesis_human'
    }
  }
}
