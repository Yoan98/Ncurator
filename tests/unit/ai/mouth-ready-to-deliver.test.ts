import { describe, expect, it } from 'vitest'
import { buildMouthPrompt } from '../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { applyBrainDecisionState, resolveBrainDecisionWatchHint } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const buildMouthDecision = (readyToDeliver: boolean): HumanDecision => ({
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
      stableMemory: initialState.memory.stable,
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toEqual({
      code: 'brain_invalid_mouth_transition',
      detail: {}
    })
    expect(nextState.execution.stage).toBe('brain')
    expect(nextState.execution.watchHint).toBe(watchHint)
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
      stableMemory: initialState.memory.stable,
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toBeUndefined()
    expect(nextState.execution.stage).toBe('mouth')
  })

  it('states in the mouth prompt that mouth cannot keep calling tools', () => {
    const prompt = buildMouthPrompt({
      state: createInitialHumanState({
        taskId: 'task-1',
        userInput: '请完成任务'
      })
    }).system

    expect(prompt).toContain('<source_of_truth>')
    expect(prompt).toContain('<context_block_guide>')
    expect(prompt).toContain('<output_contract>')
    expect(prompt).toContain('final_decision 是 brain 已经确认的最终判断')
    expect(prompt).toContain('runtime_artifacts 只允许准确引用已经给出的路径')
    expect(prompt).toContain('你不会调用工具，也不会继续推进未完成步骤')
    expect(prompt).toContain('不要把未来可能执行的工具动作写成“后续会自动完成”')
    expect(prompt).toContain('你必须只输出最终 markdown 正文')
    expect(prompt).not.toContain('"deliveryMarkdown"')
    expect(prompt).not.toContain('"summary"')
  })

  it('keeps mouth user-context blocks data-only and moves explanations into system', () => {
    const result = buildMouthPrompt({
      state: createInitialHumanState({
        taskId: 'task-2',
        userInput: '请根据当前信息给我一个最终答复'
      })
    })

    expect(result.system).toContain('final_decision：brain 已经确认的最终判断')
    expect(result.system).toContain('默认使用最终用户答复的组织方式')
    expect(result.user).not.toContain('这是当前交付模式。')
    expect(result.user).not.toContain('这是用户这次原始诉求与限制。')
    expect(result.user).not.toContain('这是 brain 已经做出的最终决定。')
    expect(result.user).not.toContain('这是任务的稳定笔记')
    expect(result.user).not.toContain('这是最近一轮最相关的过程记录。')
    expect(result.user).not.toContain('这是运行中已经产生的真实产物列表。')
    expect(result.user).not.toContain('这是当前额外的收敛或纠偏提醒。')
  })
})
