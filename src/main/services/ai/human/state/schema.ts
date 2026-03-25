import { StateSchema } from '@langchain/langgraph'
import {
  humanBrainMemoryInsideSchema,
  humanBrainMemoryOutsideSchema,
  humanBrainMemorySchema,
  humanRuntimeSchema,
  humanStateContractSchema,
  humanStageSchema,
  humanStatusSchema,
  humanTaskInputSchema,
  humanTraceSchema
} from '../schema'
import {
  DEFAULT_HUMAN_RUNTIME,
  createDefaultHumanBrainMemory,
  createDefaultHumanBrainMemoryInside,
  createDefaultHumanBrainMemoryOutside,
  createDefaultHumanSkillCatalog,
  createDefaultHumanTrace,
  createEmptyHumanTaskInput
} from '../utils/state'

export const createHumanRunStateSchema = () => {
  const runtimeSchema = humanRuntimeSchema.extend({
    stage: humanStageSchema.default(DEFAULT_HUMAN_RUNTIME.stage),
    status: humanStatusSchema.default(DEFAULT_HUMAN_RUNTIME.status)
  })
  const brainMemoryInsideSchema = humanBrainMemoryInsideSchema.extend({
    facts: humanBrainMemoryInsideSchema.shape.facts.default(() => []),
    evidences: humanBrainMemoryInsideSchema.shape.evidences.default(() => []),
    openQuestions: humanBrainMemoryInsideSchema.shape.openQuestions.default(() => [])
  })
  const brainMemoryOutsideSchema = humanBrainMemoryOutsideSchema.extend({
    skillCatalog: humanBrainMemoryOutsideSchema.shape.skillCatalog.default(createDefaultHumanSkillCatalog),
    learnedSkillIds: humanBrainMemoryOutsideSchema.shape.learnedSkillIds.default(() => []),
    brainDecisions: humanBrainMemoryOutsideSchema.shape.brainDecisions.default(() => [])
  })
  const brainMemorySchema = humanBrainMemorySchema.extend({
    inside: brainMemoryInsideSchema.default(createDefaultHumanBrainMemoryInside),
    outside: brainMemoryOutsideSchema.default(createDefaultHumanBrainMemoryOutside)
  })
  const traceSchema = humanTraceSchema.extend({
    steps: humanTraceSchema.shape.steps.default(() => [])
  })

  return new StateSchema({
    task: humanTaskInputSchema.default(createEmptyHumanTaskInput),
    runtime: runtimeSchema.default(() => ({
      ...DEFAULT_HUMAN_RUNTIME
    })),
    brainMemory: brainMemorySchema.default(createDefaultHumanBrainMemory),
    lastParallelCallToolResults: humanStateContractSchema.shape.lastParallelCallToolResults,
    lastBrainDecision: humanStateContractSchema.shape.lastBrainDecision,
    watchHint: humanStateContractSchema.shape.watchHint,
    runtimeArtifacts: humanStateContractSchema.shape.runtimeArtifacts.default(() => []),
    result: humanStateContractSchema.shape.result,
    trace: traceSchema.default(createDefaultHumanTrace)
  })
}
