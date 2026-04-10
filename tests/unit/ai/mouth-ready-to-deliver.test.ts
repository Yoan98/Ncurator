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

    expect(prompt).toContain('<available_information>')
    expect(prompt).toContain('<output_contract>')
    expect(prompt).toContain('直接回答 task_goal')
    expect(prompt).toContain('your_notes 优先')
    expect(prompt).toContain('history：任务过程中真实发生过的决策、执行和结果')
    expect(prompt).toContain('只输出最终 markdown 正文')
    expect(prompt).toContain('标题、分节、列表都按需要使用，不固定')
    expect(prompt).toContain('不原样照抄内部标签、block id、tool 名')
    expect(prompt).not.toContain('# 处理结果')
    expect(prompt).not.toContain('## 关键依据')
  })

  it('keeps mouth user-context blocks data-only and moves explanations into system', () => {
    const result = buildMouthPrompt({
      state: createInitialHumanState({
        taskId: 'task-2',
        userInput: '请根据当前信息给我一个最终答复'
      })
    })

    expect(result.system).toContain('task_goal：用户最初要你完成什么')
    expect(result.system).toContain('当前理解：当前任务的最新长期理解')
    expect(result.system).toContain('关键依据：支撑这些理解的证据')
    expect(result.system).toContain('检查清单：当前任务板')
    expect(result.user).not.toContain('这是当前交付模式。')
    expect(result.user).not.toContain('这是用户这次原始诉求与限制。')
    expect(result.user).not.toContain('这是 brain 已经做出的最终决定。')
    expect(result.user).not.toContain('这是任务的稳定笔记')
    expect(result.user).not.toContain('这是最近一轮最相关的过程记录。')
    expect(result.user).not.toContain('这是更早几轮的过程链。')
    expect(result.user).not.toContain('这是运行中已经产生的真实产物列表。')
    expect(result.user).toContain('<history>')
    expect(result.user).not.toContain('<correction_hint>')
    expect(result.user).not.toContain('<recent_progress>')
    expect(result.user).not.toContain('<earlier_attempts>')
    expect(result.user).not.toContain('<recalled_history>')
  })
})
