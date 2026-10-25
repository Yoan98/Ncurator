import { StateSchema } from '@langchain/langgraph'
import {
  humanExecutionSchema,
  humanMemorySchema,
  humanToolsetsSchema,
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

export const createDefaultHumanPlan = (): HumanState['memory']['plan'] => []

export const createDefaultHumanMemory = (): HumanState['memory'] => ({
  plan: createDefaultHumanPlan(),
  compactions: []
})

export const createDefaultHumanToolsets = (): HumanState['toolsets'] => ({
  loadedToolsetIds: []
})

export const createDefaultHumanTrace = (): HumanState['trace'] => ({
  steps: []
})

export const createDefaultHumanStateFields = (): Pick<
  HumanState,
  'task' | 'execution' | 'memory' | 'toolsets' | 'skills' | 'trace'
> => ({
  task: createEmptyHumanTaskInput(),
  execution: createDefaultHumanExecution(),
  memory: createDefaultHumanMemory(),
  toolsets: createDefaultHumanToolsets(),
  skills: { loadedSkillNames: [] },
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
    toolsets: humanToolsetsSchema.default(createDefaultHumanToolsets),
    skills: humanSkillsSchema.default(() => ({ loadedSkillNames: [] })),
    result: humanStateContractSchema.shape.result,
    trace: humanTraceSchema.default(createDefaultHumanTrace)
  })
}
