import { buildSkillCatalog } from '../tools/catalog'
import type { HumanState, HumanTaskInput } from '../types'

export const DEFAULT_HUMAN_RUNTIME: HumanState['runtime'] = {
  stage: 'brain',
  status: 'running'
}

export const createEmptyHumanTaskInput = (): HumanTaskInput => ({
  taskId: '',
  userInput: ''
})

export const createDefaultHumanSkillCatalog = (): HumanState['brainMemory']['outside']['skillCatalog'] =>
  buildSkillCatalog()

export const createDefaultHumanBrainMemoryInside = (): HumanState['brainMemory']['inside'] => ({
  facts: [],
  evidences: [],
  openQuestions: []
})

export const createDefaultHumanBrainMemoryOutside = (): HumanState['brainMemory']['outside'] => ({
  skillCatalog: createDefaultHumanSkillCatalog(),
  learnedSkillIds: [],
  brainDecisions: []
})

export const createDefaultHumanBrainMemory = (): HumanState['brainMemory'] => ({
  inside: createDefaultHumanBrainMemoryInside(),
  outside: createDefaultHumanBrainMemoryOutside()
})

export const createDefaultHumanTrace = (): HumanState['trace'] => ({
  steps: []
})

export const createDefaultHumanStateFields = (): Pick<
  HumanState,
  'task' | 'runtime' | 'brainMemory' | 'runtimeArtifacts' | 'trace'
> => ({
  task: createEmptyHumanTaskInput(),
  runtime: {
    ...DEFAULT_HUMAN_RUNTIME
  },
  brainMemory: createDefaultHumanBrainMemory(),
  runtimeArtifacts: [],
  trace: createDefaultHumanTrace()
})

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  ...createDefaultHumanStateFields(),
  task
})
