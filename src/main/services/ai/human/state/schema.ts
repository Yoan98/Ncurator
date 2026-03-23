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
  createDefaultHumanBrainMemory,
  createDefaultHumanRuntime,
  createDefaultHumanTrace,
  createEmptyHumanTaskInput
} from '../utils/state'

export const createHumanRunStateSchema = () => {
  const defaultTask = createEmptyHumanTaskInput
  const defaultRuntime = createDefaultHumanRuntime
  const defaultBrainMemory = createDefaultHumanBrainMemory
  const defaultTrace = createDefaultHumanTrace
  const runtimeSchema = humanRuntimeSchema.extend({
    stage: humanStageSchema.default(defaultRuntime().stage),
    status: humanStatusSchema.default(defaultRuntime().status)
  })
  const brainMemoryInsideSchema = humanBrainMemoryInsideSchema.extend({
    facts: humanBrainMemoryInsideSchema.shape.facts.default(() => []),
    evidences: humanBrainMemoryInsideSchema.shape.evidences.default(() => []),
    openQuestions: humanBrainMemoryInsideSchema.shape.openQuestions.default(() => [])
  })
  const brainMemoryOutsideSchema = humanBrainMemoryOutsideSchema.extend({
    skillCatalog: humanBrainMemoryOutsideSchema.shape.skillCatalog.default(
      () => defaultBrainMemory().outside.skillCatalog
    ),
    learnedSkillIds: humanBrainMemoryOutsideSchema.shape.learnedSkillIds.default(() => []),
    brainDecisions: humanBrainMemoryOutsideSchema.shape.brainDecisions.default(() => [])
  })
  const brainMemorySchema = humanBrainMemorySchema.extend({
    inside: brainMemoryInsideSchema.default(() => defaultBrainMemory().inside),
    outside: brainMemoryOutsideSchema.default(() => defaultBrainMemory().outside)
  })
  const traceSchema = humanTraceSchema.extend({
    steps: humanTraceSchema.shape.steps.default(() => [])
  })

  return new StateSchema({
    task: humanTaskInputSchema.default(defaultTask),
    runtime: runtimeSchema.default(defaultRuntime),
    brainMemory: brainMemorySchema.default(defaultBrainMemory),
    lastParallelCallToolResults: humanStateContractSchema.shape.lastParallelCallToolResults,
    lastBrainDecision: humanStateContractSchema.shape.lastBrainDecision,
    watchHint: humanStateContractSchema.shape.watchHint,
    runtimeArtifacts: humanStateContractSchema.shape.runtimeArtifacts.default(() => []),
    result: humanStateContractSchema.shape.result,
    trace: traceSchema.default(defaultTrace)
  })
}
