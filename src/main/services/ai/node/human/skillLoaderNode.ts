import type { AiRunContext } from '../../types'
import { appendHumanStepRecord, emitHumanStep } from './events'
import {
  activateSkillIds,
  buildActiveTools,
  buildLoadedSkill,
  buildSkillTools
} from './skillCatalog'
import type { HumanRunState } from './types'

const toToolNames = (state: HumanRunState): string[] => {
  return state.activeTools
    .map((tool) => String(tool.name || '').trim())
    .filter(Boolean)
}

export const createHumanSkillLoaderNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    ctx.checkCancelled()

    const decision = state.lastDecision
    if (!decision || decision.action !== 'load_skill') {
      const summary = 'missing skill loader decision'
      const activeToolNames = toToolNames(state)
      const nextHistory = appendHumanStepRecord({
        history: state.stepHistory,
        step: state.steps,
        action: 'block_task',
        publicNarrative: '当前缺少可执行的能力加载决策，因此任务被阻塞。',
        activeSkillIds: state.activeSkillIds,
        activeToolNames,
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

    const wasLoaded = state.loadedSkills[decision.skillId] !== undefined
    const loadedSkills = { ...state.loadedSkills }
    const loadedToolsets = { ...state.loadedToolsets }

    if (!wasLoaded) {
      loadedSkills[decision.skillId] = buildLoadedSkill(decision.skillId, state.steps)
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
    const activeTools = buildActiveTools({
      activeSkillIds,
      loadedToolsets
    })
    const activeToolNames = activeTools
      .map((tool) => String(tool.name || '').trim())
      .filter(Boolean)
    const summary = wasLoaded
      ? `skill re-activated: ${decision.skillId}`
      : `skill loaded: ${decision.skillId}`
    const lastObservation = {
      kind: 'skill_loaded' as const,
      skillId: decision.skillId,
      summary,
      activeSkillIds,
      activeToolNames
    }
    const nextHistory = appendHumanStepRecord({
      history: state.stepHistory,
      step: state.steps,
      action: 'load_skill',
      publicNarrative: decision.publicNarrative,
      activeSkillIds,
      activeToolNames,
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
      phase: 'brain',
      loadedSkills,
      loadedToolsets,
      activeSkillIds,
      activeTools,
      lastObservation,
      stepHistory: nextHistory
    }
  }
}
