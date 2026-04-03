import { describe, expect, it } from 'vitest'
import { buildMouthSystemPrompt } from '../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { applyBrainDecisionState, resolveBrainDecisionWatchHint } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import type { LastBrainDecision } from '../../../src/main/services/ai/human/types'

const buildMouthDecision = (readyToDeliver: boolean): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: '尝试收尾',
    reason: '测试 mouth 收尾契约。',
    expectedOutcome: '验证 readyToDeliver 对 stage 的影响。'
  },
  readyToDeliver,
  nextAction: {
    action: 'mouth'
  }
})

describe('ai unit mouth readyToDeliver guard', () => {
  it('keeps the state in brain when mouth is selected before readyToDeliver', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请完成任务'
    })
    const decision = buildMouthDecision(false)
    const watchHint = resolveBrainDecisionWatchHint({
      decision
    })
    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      reducedInside: initialState.brainMemory.inside,
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toEqual({
      code: 'brain_invalid_mouth_transition',
      detail: {}
    })
    expect(nextState.runtime.stage).toBe('brain')
    expect(nextState.watchHint).toBe(watchHint)
  })

  it('allows mouth only when readyToDeliver is true', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请完成任务'
    })
    const decision = buildMouthDecision(true)
    const watchHint = resolveBrainDecisionWatchHint({
      decision
    })
    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      reducedInside: initialState.brainMemory.inside,
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toBeUndefined()
    expect(nextState.runtime.stage).toBe('mouth')
  })

  it('states in the mouth prompt that mouth cannot keep calling tools', () => {
    const prompt = buildMouthSystemPrompt('user_answer')

    expect(prompt).toContain('你不会调用工具，也不会继续推进未完成步骤')
    expect(prompt).toContain('不要把未来可能执行的工具动作写成“后续会自动完成”')
  })
})
