import type {
  AiDirectorStage,
  DirectorNodeContext,
  HumanRunDispatchOptions,
  HumanTaskOutput,
  HumanTaskRunner
} from '../../types'

type DirectorHumanDispatchStage = Extract<
  AiDirectorStage,
  | 'director_context_human'
  | 'director_plan_exec'
  | 'director_direct_human_exec'
  | 'director_synthesis_human'
>

export const runDirectorHumanSubtask = async (input: {
  ctx: DirectorNodeContext
  runId: string
  taskId: string
  stage: DirectorHumanDispatchStage
  userInput: string
  runHumanTask: HumanTaskRunner
  options: HumanRunDispatchOptions
}): Promise<HumanTaskOutput> => {
  input.ctx.checkCancelled()

  input.ctx.sendEvent({
    type: 'task_started',
    runId: input.runId,
    taskId: input.taskId,
    stage: input.stage
  })

  const output = await input.runHumanTask(
    {
      taskId: input.taskId,
      userInput: input.userInput
    },
    input.options
  )

  input.ctx.sendEvent({
    type: 'task_completed',
    runId: input.runId,
    taskId: input.taskId,
    stage: input.stage
  })

  return output
}
