import type { AiRunState, DirectorNodeContext, HumanTaskRunner } from '../../types'
import { buildPlanTaskObjective } from './objectives'
import { pickPendingTaskIndex } from './helpers'
import { createDirectorHumanDispatchNode } from './humanDispatch'

export const createPlanExecNode = (input: {
  ctx: DirectorNodeContext
  runHumanTask: HumanTaskRunner
}) =>
  createDirectorHumanDispatchNode({
    ...input,
    prepare: (state: AiRunState) => {
      const taskIndex = pickPendingTaskIndex(state.plan, state.dispatchCursor)
      if (taskIndex < 0) {
        return {
          skipPatch: {
            directorStage: 'director_synthesis_human'
          }
        }
      }

      const task = state.plan[taskIndex]
      return {
        taskId: task.id,
        stage: 'director_plan_exec',
        userInput: buildPlanTaskObjective({
          userInput: state.input,
          task,
          selectedScopeSummary: input.ctx.selectedScopeSummary,
          contextEvidence: state.contextEvidence,
          priorDeliveries: state.plan.slice(0, taskIndex).filter((item) => Boolean(item.deliveryMarkdown))
        }),
        options: {
          deliveryMode: 'task_handoff'
        },
        buildPatch: (output) => {
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
            directorStage: !hasPending ? 'director_synthesis_human' : 'director_plan_exec'
          }
        }
      }
    }
  })
