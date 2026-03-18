import type { AiRunContext } from '../../types'
import { appendHumanStepRecord, emitHumanStep } from './events'
import {
  activateSkillIds,
  buildSkillTools
} from './skillCatalog'
import { deriveActiveToolNames } from './runtimeState'
import type { HumanRunState } from './types'

export const createHumanSkillLoaderNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    ctx.checkCancelled()

    const decision = state.lastDecision
    if (!decision || decision.action !== 'load_skill') {
      const summary = 'missing skill loader decision'
      const activeToolNames = deriveActiveToolNames(state)
      const nextHistory = appendHumanStepRecord({
        history: state.stepHistory,
        step: state.steps,
        action: 'block_task',
        publicNarrative: '当前缺少可执行的能力加载决策，因此任务被阻塞。',
        resultStatus: 'blocked',
        summary
      })

      emitHumanStep({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'block_task',
        publicNarrative: '当前缺少可执行的能力加载决策，因此任务被阻塞。',
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
        summary,
        resultStatus: 'blocked',
        stage: 'human_skill_loader'
      })

      return {
        status: 'blocked',
        lastObservation: {
          kind: 'terminal',
          status: 'blocked',
          code: 'invalid_input',
          summary
        },
        stepHistory: nextHistory,
        summary,
        resultCode: 'invalid_input'
      }
    }

    const wasLoaded = state.loadedSkillIds.includes(decision.skillId)
    const loadedSkillIds = wasLoaded ? [...state.loadedSkillIds] : [...state.loadedSkillIds, decision.skillId]
    const loadedToolsets = { ...state.loadedToolsets }

    if (!loadedToolsets[decision.skillId]) {
      loadedToolsets[decision.skillId] = buildSkillTools(decision.skillId, {
        ctx,
        runId: state.runId,
        taskId: state.input.taskId
      })
    }

    const activeSkillIds = activateSkillIds({
      skillId: decision.skillId,
      activeSkillIds: state.activeSkillIds
    })
    const activeToolNames = deriveActiveToolNames({
      activeSkillIds,
      loadedToolsets
    })
    const summary = wasLoaded
      ? `skill re-activated: ${decision.skillId}`
      : `skill loaded: ${decision.skillId}`
    const lastObservation = {
      kind: 'skill_loaded' as const,
      skillId: decision.skillId,
      summary
    }
    const nextHistory = appendHumanStepRecord({
      history: state.stepHistory,
      step: state.steps,
      action: 'load_skill',
      publicNarrative: decision.publicNarrative,
      resultStatus: 'ok',
      skillId: decision.skillId,
      summary
    })

    emitHumanStep({
      ctx,
      runId: state.runId,
      taskId: state.input.taskId,
      stepIndex: state.steps,
      action: 'load_skill',
      publicNarrative: decision.publicNarrative,
      activeSkillIds,
      activeToolNames,
      summary,
      resultStatus: 'ok',
      skillId: decision.skillId,
      stage: 'human_skill_loader'
    })

    return {
      status: 'brain',
      loadedSkillIds,
      loadedToolsets,
      activeSkillIds,
      lastObservation,
      stepHistory: nextHistory
    }
  }
}
