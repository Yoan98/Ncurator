import { StateSchema } from '@langchain/langgraph'
import {
  humanBrainMemorySchema,
  humanRuntimeSchema,
  humanStateContractSchema,
  humanTaskInputSchema,
  humanTraceSchema
} from '../schema'
import {
  createDefaultHumanRuntime,
  createDefaultHumanBrainMemory,
  createDefaultHumanTrace,
  createEmptyHumanTaskInput
} from '../utils/state'

export const createHumanRunStateSchema = () => {
  return new StateSchema({
    task: humanTaskInputSchema.default(createEmptyHumanTaskInput),
    runtime: humanRuntimeSchema.default(createDefaultHumanRuntime),
    brainMemory: humanBrainMemorySchema.default(createDefaultHumanBrainMemory),
    lastParallelCallToolResults: humanStateContractSchema.shape.lastParallelCallToolResults,
    lastBrainDecision: humanStateContractSchema.shape.lastBrainDecision,
    watchHint: humanStateContractSchema.shape.watchHint,
    runtimeArtifacts: humanStateContractSchema.shape.runtimeArtifacts.default(() => []),
    result: humanStateContractSchema.shape.result,
    trace: humanTraceSchema.default(createDefaultHumanTrace)
  })
}
