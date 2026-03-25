import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildPlanTaskObjective } from './objectives'
import { pickPendingTaskIndex } from './helpers'
import { runDirectorHumanSubtask } from './humanSubtasks'

export const createPlanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const taskIndex = pickPendingTaskIndex(state.plan, state.dispatchCursor)
    if (taskIndex < 0) {
      return {
        directorStage: 'director_synthesis_human'
      }
    }

    const task = state.plan[taskIndex]
    const output = await runDirectorHumanSubtask({
      ctx,
      runId: state.runId,
      taskId: task.id,
      stage: 'director_plan_exec',
      userInput: buildPlanTaskObjective({
        userInput: state.input,
        task,
        selectedScopeSummary: ctx.selectedScopeSummary,
        contextEvidence: state.contextEvidence,
        priorDeliveries: state.plan.slice(0, taskIndex).filter((item) => Boolean(item.deliveryMarkdown))
      }),
      runHumanTask,
      options: {
        deliveryMode: 'task_handoff'
      }
    })

    const runningPlan = state.plan.map((item, index) =>
      index === taskIndex ? { ...item, status: 'running' as const } : item
    )
    const nextPlan = runningPlan.map((item, index) => {
      if (index !== taskIndex) return item

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
      directorStage: hasPending ? 'director_plan_exec' : 'director_synthesis_human'
    }
  }
}
