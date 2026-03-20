import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState, RuntimeSkillId } from '../../types'
import { ensureSkillTools, getAvailableToolNames } from './skillLoader'
import { hasSkillDefinition } from './skillRegistry'
import { appendHumanTraceStep, emitHumanStep, emitWatchHint } from '../utils/events'

const buildDuplicateLearnHint = (skillId: string) =>
  `learning 请求重复学习 ${skillId}，已忽略本次学习并返回 brain 重新决策。`

const buildUnknownSkillHint = (skillId: string) =>
  `learning 收到未知 skill ${skillId}，已返回 brain 重新决策。`

const buildLearnSkillStep = (input: {
  steps: HumanState['trace']['steps']
  skillId: RuntimeSkillId
}) =>
  appendHumanTraceStep({
    steps: input.steps,
    action: 'learn_skill',
    publicNarrative: `已学习 ${input.skillId}`,
    resultStatus: 'ok',
    skillId: input.skillId,
    summary: `learning 已加载 ${input.skillId} 的说明与工具。`
  })

export const createLearningNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    if (!state.lastBrainDecision || state.lastBrainDecision.nextAction.action !== 'learning') {
      return {
        ...state,
        runtime: {
          ...state.runtime,
          stage: 'brain'
        }
      }
    }

    const requestedSkillIds = state.lastBrainDecision.nextAction.wantLearnSkillIds
    const unknownSkillId = requestedSkillIds.find((skillId) => !hasSkillDefinition(skillId))
    if (unknownSkillId) {
      const watchHint = buildUnknownSkillHint(unknownSkillId)
      emitWatchHint({
        ctx: input.ctx,
        taskId: state.task.taskId,
        source: 'learning',
        summary: watchHint
      })
      return {
        ...state,
        runtime: {
          ...state.runtime,
          stage: 'brain'
        },
        watchHint
      }
    }

    const duplicatedSkillId = requestedSkillIds.find((skillId) =>
      state.brainMemory.outside.learnedSkillIds.includes(skillId)
    )
    if (duplicatedSkillId) {
      const watchHint = buildDuplicateLearnHint(duplicatedSkillId)
      emitWatchHint({
        ctx: input.ctx,
        taskId: state.task.taskId,
        source: 'learning',
        summary: watchHint
      })
      return {
        ...state,
        runtime: {
          ...state.runtime,
          stage: 'brain'
        },
        watchHint
      }
    }

    let traceSteps = state.trace.steps
    requestedSkillIds.forEach((skillId) => {
      ensureSkillTools({
        cache: input.cache,
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        skillId
      })
      traceSteps = buildLearnSkillStep({
        steps: traceSteps,
        skillId
      })
    })
    const learnedSkillIds = [
      ...state.brainMemory.outside.learnedSkillIds,
      ...requestedSkillIds
    ]
    const nextState: HumanState = {
      ...state,
      runtime: {
        ...state.runtime,
        stage: 'brain'
      },
      brainMemory: {
        ...state.brainMemory,
        outside: {
          ...state.brainMemory.outside,
          learnedSkillIds
        }
      },
      watchHint: undefined,
      trace: {
        steps: traceSteps
      }
    }
    const availableToolNames = getAvailableToolNames({
      learnedSkillIds,
      cache: input.cache
    })
    nextState.trace.steps.slice(-requestedSkillIds.length).forEach((step) => {
      emitHumanStep({
        ctx: input.ctx,
        taskId: state.task.taskId,
        step,
        learnedSkillIds,
        availableToolNames,
        stage: 'human_learning'
      })
    })
    return nextState
  }
}
