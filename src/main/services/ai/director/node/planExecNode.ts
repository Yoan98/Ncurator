import type { DirectorNodeContext, HumanTaskRunner } from '../../types'
import type { DirectorGraphState } from '../state/schema'
import { buildPlanTaskObjective } from './objectives'
import { pickPendingTaskIndex } from './helpers'
import { runDirectorHumanSubtask } from './humanSubtasks'

const completePlanTask = (input: {
  state: DirectorGraphState
  taskIndex: number
}) => {
  const output = input.state.planExecPendingTaskOutput
  const nextPlan = input.state.plan.map((item, index) => {
    if (index !== input.taskIndex) return item

    return {
      ...item,
      status: 'completed' as const,
      deliveryMarkdown: output?.deliveryMarkdown,
      artifacts: output?.artifacts
    }
  })
  const hasPending = nextPlan.some((item) => item.status === 'ready')

  return {
    plan: nextPlan,
    dispatchCursor: input.taskIndex + 1,
    directorStage: hasPending ? 'director_plan_exec' : 'director_synthesis_human',
    planExecPendingTaskIndex: undefined,
    planExecPendingTaskOutput: undefined
  } satisfies Partial<DirectorGraphState>
}

export const createPlanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: DirectorGraphState): Promise<Partial<DirectorGraphState>> => {
    ctx.checkCancelled()

    if (typeof state.planExecPendingTaskIndex === 'number' && state.planExecPendingTaskOutput) {
      return completePlanTask({
        state,
        taskIndex: state.planExecPendingTaskIndex
      })
    }

    if (typeof state.planExecPendingTaskIndex === 'number') {
      const taskIndex = state.planExecPendingTaskIndex
      const task = state.plan[taskIndex]
      if (!task) {
        return {
          planExecPendingTaskIndex: undefined,
          planExecPendingTaskOutput: undefined,
          directorStage: 'director_synthesis_human'
        }
      }

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
          priorDeliveries: state.plan
            .slice(0, taskIndex)
            .filter((item) => Boolean(item.deliveryMarkdown))
        }),
        runHumanTask,
        options: {
          deliveryMode: 'task_handoff'
        }
      })

      return {
        planExecPendingTaskOutput: output
      }
    }

    const taskIndex = pickPendingTaskIndex(state.plan, state.dispatchCursor)
    if (taskIndex < 0) {
      return {
        directorStage: 'director_synthesis_human'
      }
    }

    return {
      plan: state.plan.map((item, index) =>
      index === taskIndex ? { ...item, status: 'running' as const } : item
      ),
      dispatchCursor: taskIndex,
      planExecPendingTaskIndex: taskIndex,
      planExecPendingTaskOutput: undefined,
      directorStage: 'director_plan_exec'
    }
  }
}
