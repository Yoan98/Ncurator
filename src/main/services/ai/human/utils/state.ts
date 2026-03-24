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

export const createDefaultHumanFacts = (): HumanState['brainMemory']['inside']['facts'] => []

export const createDefaultHumanEvidences = (): HumanState['brainMemory']['inside']['evidences'] => []

export const createDefaultHumanOpenQuestions = (): HumanState['brainMemory']['inside']['openQuestions'] => []

export const createDefaultHumanSkillCatalog = (): HumanState['brainMemory']['outside']['skillCatalog'] =>
  buildSkillCatalog()

export const createDefaultHumanLearnedSkillIds = (): HumanState['brainMemory']['outside']['learnedSkillIds'] =>
  []

export const createDefaultHumanBrainDecisions = (): HumanState['brainMemory']['outside']['brainDecisions'] =>
  []

export const createDefaultHumanRuntimeArtifacts = (): HumanState['runtimeArtifacts'] => []

export const createDefaultHumanTraceSteps = (): HumanState['trace']['steps'] => []

export const createDefaultHumanBrainMemoryInside = (): HumanState['brainMemory']['inside'] => ({
  facts: createDefaultHumanFacts(),
  evidences: createDefaultHumanEvidences(),
  openQuestions: createDefaultHumanOpenQuestions()
})

export const createDefaultHumanBrainMemoryOutside = (): HumanState['brainMemory']['outside'] => ({
  skillCatalog: createDefaultHumanSkillCatalog(),
  learnedSkillIds: createDefaultHumanLearnedSkillIds(),
  brainDecisions: createDefaultHumanBrainDecisions()
})

export const createDefaultHumanBrainMemory = (): HumanState['brainMemory'] => ({
  inside: createDefaultHumanBrainMemoryInside(),
  outside: createDefaultHumanBrainMemoryOutside()
})

export const createDefaultHumanTrace = (): HumanState['trace'] => ({
  steps: createDefaultHumanTraceSteps()
})

export const createDefaultHumanStateFields = (): Pick<
  HumanState,
  'task' | 'runtime' | 'brainMemory' | 'runtimeArtifacts' | 'trace'
> => ({
  task: createEmptyHumanTaskInput(),
  runtime: createDefaultHumanRuntime(),
  brainMemory: createDefaultHumanBrainMemory(),
  runtimeArtifacts: createDefaultHumanRuntimeArtifacts(),
  trace: createDefaultHumanTrace()
})

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  ...createDefaultHumanStateFields(),
  task
})
