import { randomUUID } from 'node:crypto'
import type { AiRunContext } from '../../../types'
import type { HumanActionSpec, HumanObservation, HumanRuntimeCache, HumanState } from '../../types'
import { activateCapabilityStack, ensureRuntimeSkillTools } from '../shared/runtime'

export const executeCapabilityActivation = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  action: Extract<HumanActionSpec, { type: 'activate_capability' }>
}): {
  nextState: HumanState
  observation: HumanObservation
} => {
  ensureRuntimeSkillTools({
    cache: input.cache,
    ctx: input.ctx,
    runId: input.ctx.runId,
    taskId: input.state.task.taskId,
    skillId: input.action.skillId
  })

  const activeStack = activateCapabilityStack({
    skillId: input.action.skillId,
    current: input.state.memory.capabilityFocus.activeStack
  })

  const observation: HumanObservation = {
    id: randomUUID(),
    kind: 'capability_activated',
    skillId: input.action.skillId,
    summary: `capability activated: ${input.action.skillId}`
  }

  return {
    nextState: {
      ...input.state,
      memory: {
        ...input.state.memory,
        capabilityFocus: {
          activeStack
        }
      }
    },
    observation
  }
}
