import { StateSchema } from '@langchain/langgraph'
import { buildSkillCatalog } from '../skills'
import {
  humanBrainMemorySchema,
  humanRuntimeSchema,
  humanStateContractSchema,
  humanTaskInputSchema,
  humanTraceSchema
} from '../schema'
import type { HumanState, HumanTaskInput } from '../types'

export const DEFAULT_HUMAN_RUNTIME: HumanState['runtime'] = {
  stage: 'brain',
  status: 'running'
}

export const createDefaultHumanRuntime = (): HumanState['runtime'] => ({
  ...DEFAULT_HUMAN_RUNTIME
})

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

export const createDefaultHumanProcessMemory = (): HumanState['processMemory'] => ({
  roundHistory: []
})

export const createDefaultHumanTrace = (): HumanState['trace'] => ({
  steps: []
})

export const createDefaultHumanStateFields = (): Pick<
  HumanState,
  'task' | 'runtime' | 'brainMemory' | 'processMemory' | 'runtimeArtifacts' | 'trace'
> => ({
  task: createEmptyHumanTaskInput(),
  runtime: createDefaultHumanRuntime(),
  brainMemory: createDefaultHumanBrainMemory(),
  processMemory: createDefaultHumanProcessMemory(),
  runtimeArtifacts: [],
  trace: createDefaultHumanTrace()
})

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  ...createDefaultHumanStateFields(),
  task
})

export const createHumanRunStateSchema = () => {
  return new StateSchema({
    task: humanTaskInputSchema.default(createEmptyHumanTaskInput),
    runtime: humanRuntimeSchema.default(createDefaultHumanRuntime),
    brainMemory: humanBrainMemorySchema.default(createDefaultHumanBrainMemory),
    processMemory: humanStateContractSchema.shape.processMemory.default(createDefaultHumanProcessMemory),
    lastToolUseResults: humanStateContractSchema.shape.lastToolUseResults,
    lastLearningOutcome: humanStateContractSchema.shape.lastLearningOutcome,
    lastBrainDecision: humanStateContractSchema.shape.lastBrainDecision,
    watchHint: humanStateContractSchema.shape.watchHint,
    runtimeArtifacts: humanStateContractSchema.shape.runtimeArtifacts.default(() => []),
    result: humanStateContractSchema.shape.result,
    trace: humanTraceSchema.default(createDefaultHumanTrace)
  })
}
