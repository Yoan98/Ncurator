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
  createDefaultHumanBrainDecisions,
  createDefaultHumanBrainMemory,
  createDefaultHumanBrainMemoryInside,
  createDefaultHumanBrainMemoryOutside,
  createDefaultHumanEvidences,
  createDefaultHumanFacts,
  createDefaultHumanLearnedSkillIds,
  createDefaultHumanOpenQuestions,
  createDefaultHumanRuntime,
  createDefaultHumanRuntimeArtifacts,
  createDefaultHumanSkillCatalog,
  createDefaultHumanTrace,
  createDefaultHumanTraceSteps,
  createEmptyHumanTaskInput
} from '../utils/state'

export const createHumanRunStateSchema = () => {
  const runtimeDefaults = createDefaultHumanRuntime()
  const runtimeSchema = humanRuntimeSchema.extend({
    stage: humanStageSchema.default(runtimeDefaults.stage),
    status: humanStatusSchema.default(runtimeDefaults.status)
  })
  const brainMemoryInsideSchema = humanBrainMemoryInsideSchema.extend({
    facts: humanBrainMemoryInsideSchema.shape.facts.default(createDefaultHumanFacts),
    evidences: humanBrainMemoryInsideSchema.shape.evidences.default(createDefaultHumanEvidences),
    openQuestions: humanBrainMemoryInsideSchema.shape.openQuestions.default(
      createDefaultHumanOpenQuestions
    )
  })
  const brainMemoryOutsideSchema = humanBrainMemoryOutsideSchema.extend({
    skillCatalog: humanBrainMemoryOutsideSchema.shape.skillCatalog.default(createDefaultHumanSkillCatalog),
    learnedSkillIds: humanBrainMemoryOutsideSchema.shape.learnedSkillIds.default(
      createDefaultHumanLearnedSkillIds
    ),
    brainDecisions: humanBrainMemoryOutsideSchema.shape.brainDecisions.default(
      createDefaultHumanBrainDecisions
    )
  })
  const brainMemorySchema = humanBrainMemorySchema.extend({
    inside: brainMemoryInsideSchema.default(createDefaultHumanBrainMemoryInside),
    outside: brainMemoryOutsideSchema.default(createDefaultHumanBrainMemoryOutside)
  })
  const traceSchema = humanTraceSchema.extend({
    steps: humanTraceSchema.shape.steps.default(createDefaultHumanTraceSteps)
  })

  return new StateSchema({
    task: humanTaskInputSchema.default(createEmptyHumanTaskInput),
    runtime: runtimeSchema.default(createDefaultHumanRuntime),
    brainMemory: brainMemorySchema.default(createDefaultHumanBrainMemory),
    lastParallelCallToolResults: humanStateContractSchema.shape.lastParallelCallToolResults,
    lastBrainDecision: humanStateContractSchema.shape.lastBrainDecision,
    watchHint: humanStateContractSchema.shape.watchHint,
    runtimeArtifacts: humanStateContractSchema.shape.runtimeArtifacts.default(
      createDefaultHumanRuntimeArtifacts
    ),
    result: humanStateContractSchema.shape.result,
    trace: traceSchema.default(createDefaultHumanTrace)
  })
}
