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

export const createDefaultHumanStateFields = (): Pick<
  HumanState,
  'task' | 'runtime' | 'brainMemory' | 'runtimeArtifacts' | 'trace'
> => ({
  task: createEmptyHumanTaskInput(),
  runtime: createDefaultHumanRuntime(),
  brainMemory: createDefaultHumanBrainMemory(),
  runtimeArtifacts: [],
  trace: createDefaultHumanTrace()
})

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  ...createDefaultHumanStateFields(),
  task
})
