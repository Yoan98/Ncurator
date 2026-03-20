import type { HumanRuntimeCache, HumanState, HumanTaskInput } from '../../types'

export const createHumanRuntimeCache = (): HumanRuntimeCache => ({
  toolsets: {}
})

export const createInitialHumanState = (input: {
  task: HumanTaskInput
  allowNonLocal: boolean
  maxParallel?: number
}): HumanState => ({
  task: input.task,
  progress: {
    phase: 'reasoning',
    maxParallel: Math.max(1, input.maxParallel ?? 2)
  },
  memory: {
    constraints: [
      '优先使用已选资料范围与本地能力。',
      input.allowNonLocal ? '允许在本地不足时明确说明非本地信息需求。' : '不要越出当前本地资料范围。'
    ],
    facts: [],
    evidence: [],
    openQuestions: [],
    focus: {
      current: undefined
    },
    capabilityFocus: {
      activeStack: []
    }
  },
  turn: {},
  trace: {
    steps: []
  }
})
