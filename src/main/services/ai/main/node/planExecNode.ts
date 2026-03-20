import type { AiRunContext, AiRunState, HumanTaskRunner } from '../../types'
import { buildPlanTaskObjective } from './objectives'
import { pickPendingTaskIndex } from './helpers'

export const createPlanExecNode = (input: {
  ctx: AiRunContext
  runHumanTask: HumanTaskRunner
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    // 按 cursor 串行选择 pending task；无任务时进入 synthesis。
    const taskIndex = pickPendingTaskIndex(state.plan, state.dispatchCursor)
    if (taskIndex < 0) {
      return {
        mainStage: 'main_synthesis_human'
      }
    }

    const task = state.plan[taskIndex]
    const objective = buildPlanTaskObjective({
      userInput: state.input,
      task,
      selectedScopeSummary: ctx.selectedScopeSummary,
      contextEvidence: state.contextEvidence,
      priorDeliveries: state.plan.slice(0, taskIndex).filter((item) => Boolean(item.deliveryMarkdown))
    })
    const runningPlan = state.plan.map((item, index) =>
      index === taskIndex ? { ...item, status: 'running' as const } : item
    )

    ctx.sendEvent({
      type: 'task_started',
      runId: state.runId,
      taskId: task.id,
      stage: 'main_plan_exec'
    })

    const output = await runHumanTask({
      taskId: task.id,
      objective
    })

    // 当前策略为 stop-dispatch：单任务 blocked 会停止后续业务任务，但保留 synthesis 收口。
    const blocked = output.status === 'blocked'

    const nextPlan = runningPlan.map((item, index) => {
      if (index !== taskIndex) return item
      if (blocked) {
        return {
          ...item,
          status: 'failed' as const,
          attempts: Number(item.attempts || 0) + 1,
          error: output.summary,
          resultCode: output.resultCode,
          resultMessage: output.summary,
          deliveryMarkdown: output.deliveryMarkdown,
          resultData: output.resultData
        }
      }
      return {
        ...item,
        status: 'completed' as const,
        attempts: Number(item.attempts || 0) + 1,
        error: undefined,
        resultCode: output.resultCode,
        resultMessage: output.summary,
        deliveryMarkdown: output.deliveryMarkdown,
        resultData: output.resultData
      }
    })

    if (blocked) {
      ctx.sendEvent({
        type: 'task_failed',
        runId: state.runId,
        taskId: task.id,
        error: output.summary,
        stage: 'main_plan_exec'
      })
    } else {
      ctx.sendEvent({
        type: 'task_completed',
        runId: state.runId,
        taskId: task.id,
        stage: 'main_plan_exec'
      })
    }

    ctx.sendEvent({
      type: 'task_result',
      runId: state.runId,
      taskId: task.id,
      code: output.resultCode,
      message: output.summary,
      data: output.resultData,
      stage: 'main_plan_exec'
    })

    const hasPending = nextPlan.some((item) => item.status === 'pending')

    return {
      plan: nextPlan,
      dispatchCursor: taskIndex + 1,
      error: blocked ? output.summary : state.error,
      mainStage: blocked ? 'main_synthesis_human' : hasPending ? 'main_plan_exec' : 'main_synthesis_human'
    }
  }
}
