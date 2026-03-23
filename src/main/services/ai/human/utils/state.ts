import { buildSkillCatalog } from '../node/learningNode/skillRegistry'
import type { HumanState, HumanTaskInput } from '../types'

export const createEmptyHumanTaskInput = (): HumanTaskInput => ({
  taskId: '',
  userInput: ''
})

export const createDefaultHumanRuntime = (): HumanState['runtime'] => ({
  stage: 'brain',
  status: 'running'
})

export const createDefaultHumanBrainMemory = (): HumanState['brainMemory'] => ({
  inside: {
    facts: [],
    evidences: [],
    openQuestions: []
  },
  outside: {
    skillCatalog: buildSkillCatalog(),
    learnedSkillIds: [],
    brainDecisions: []
  }
})

export const createDefaultHumanTrace = (): HumanState['trace'] => ({
  steps: []
})

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  task,
  runtime: createDefaultHumanRuntime(),
  brainMemory: createDefaultHumanBrainMemory(),
  runtimeArtifacts: [],
  trace: createDefaultHumanTrace()
})
