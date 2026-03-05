import type { HumanTaskInput } from '../../../../../shared/types'
import type { AiRunContext, AiRunState } from '../../types'
import { pickPendingTaskIndex } from './helpers'

export const createPlanExecNode = (input: {
  ctx: AiRunContext
  runHumanTask: (
    taskInput: HumanTaskInput
  ) => Promise<import('../../../../../shared/types').HumanTaskOutput>
}) => {
  const { ctx, runHumanTask } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    // 按 cursor 串行选择 pending task；无任务时进入 finalize。
    const taskIndex = pickPendingTaskIndex(state.plan, state.dispatchCursor)
    if (taskIndex < 0) {
      return {
        mainStage: 'main_finalize'
      }
    }

    const task = state.plan[taskIndex]
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
      objective: task.objective
    })

    // 当前策略为 fail-fast：单任务 blocked 会直接触发主流程收敛。
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
      status: blocked ? 'failed' : state.status,
      error: blocked ? output.summary : state.error,
      outputText: output.summary,
      mainStage: blocked ? 'main_finalize' : hasPending ? 'main_plan_exec' : 'main_finalize'
    }
  }
}
