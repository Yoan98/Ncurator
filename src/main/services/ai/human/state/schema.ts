import { StateSchema } from '@langchain/langgraph'
import {
  humanExecutionSchema,
  humanMemorySchema,
  humanSkillsSchema,
  humanStateContractSchema,
  humanTaskInputSchema,
  humanTraceSchema
} from '../schema'
import type { HumanState, HumanTaskInput } from '../types'

export const DEFAULT_HUMAN_EXECUTION: HumanState['execution'] = {
  stage: 'brain',
  status: 'running',
  artifacts: []
}

export const createDefaultHumanExecution = (): HumanState['execution'] => ({
  ...DEFAULT_HUMAN_EXECUTION,
  artifacts: []
})

export const createEmptyHumanTaskInput = (): HumanTaskInput => ({
  taskId: '',
  userInput: ''
})

export const createDefaultHumanStableMemory = (): HumanState['memory']['stable'] => ({
  confirmedFacts: '',
  keyEvidence: '',
  openQuestions: ''
})

export const createDefaultHumanMemoryHistory = (): HumanState['memory']['history'] => ({
  roundHistory: []
})

export const createDefaultHumanMemory = (): HumanState['memory'] => ({
  stable: createDefaultHumanStableMemory(),
  history: createDefaultHumanMemoryHistory()
})

export const createDefaultHumanSkills = (): HumanState['skills'] => ({
  learnedSkillIds: []
})

export const createDefaultHumanTrace = (): HumanState['trace'] => ({
  steps: []
})

export const createDefaultHumanStateFields = (): Pick<
  HumanState,
  'task' | 'execution' | 'memory' | 'skills' | 'trace'
> => ({
  task: createEmptyHumanTaskInput(),
  execution: createDefaultHumanExecution(),
  memory: createDefaultHumanMemory(),
  skills: createDefaultHumanSkills(),
  trace: createDefaultHumanTrace()
})

export const createInitialHumanState = (task: HumanTaskInput): HumanState => ({
  ...createDefaultHumanStateFields(),
  task
})

export const createHumanRunStateSchema = () => {
  return new StateSchema({
    task: humanTaskInputSchema.default(createEmptyHumanTaskInput),
    execution: humanExecutionSchema.default(createDefaultHumanExecution),
    memory: humanMemorySchema.default(createDefaultHumanMemory),
    skills: humanSkillsSchema.default(createDefaultHumanSkills),
    result: humanStateContractSchema.shape.result,
    trace: humanTraceSchema.default(createDefaultHumanTrace)
  })
}
