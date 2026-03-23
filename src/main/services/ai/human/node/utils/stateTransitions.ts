import type { WatchHintSource } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanState, RuntimeSkillId } from '../../types'
import { emitHumanStep, emitWatchHint } from './events'

export const returnToBrain = (
  state: HumanState,
  overrides: Partial<Omit<HumanState, 'runtime'>> & {
    runtime?: Partial<HumanState['runtime']>
  } = {}
): HumanState => ({
  ...state,
  ...overrides,
  runtime: {
    ...state.runtime,
    ...overrides.runtime,
    stage: 'brain'
  }
})

export const returnToBrainWithWatchHint = (input: {
  ctx: AiRunContext
  state: HumanState
  source: WatchHintSource
  watchHint: string
  overrides?: Partial<Omit<HumanState, 'runtime' | 'watchHint'>> & {
    runtime?: Partial<HumanState['runtime']>
  }
}): HumanState => {
  emitWatchHint({
    ctx: input.ctx,
    taskId: input.state.task.taskId,
    source: input.source,
    summary: input.watchHint
  })
  return returnToBrain(input.state, {
    ...input.overrides,
    watchHint: input.watchHint
  })
}

export const emitTailHumanSteps = (input: {
  ctx: AiRunContext
  taskId: string
  steps: HumanState['trace']['steps']
  count: number
  learnedSkillIds: RuntimeSkillId[]
  availableToolNames: string[]
  stage: 'human_brain' | 'human_learning' | 'human_hand' | 'human_mouth'
}) => {
  if (input.count <= 0) return
  input.steps.slice(-input.count).forEach((step) => {
    emitHumanStep({
      ctx: input.ctx,
      taskId: input.taskId,
      step,
      learnedSkillIds: input.learnedSkillIds,
      availableToolNames: input.availableToolNames,
      stage: input.stage
    })
  })
}
