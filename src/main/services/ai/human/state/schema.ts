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
  createDefaultHumanStateFields
} from '../utils/state'

export const createHumanRunStateSchema = () => {
  const defaults = createDefaultHumanStateFields()
  const runtimeSchema = humanRuntimeSchema.extend({
    stage: humanStageSchema.default(defaults.runtime.stage),
    status: humanStatusSchema.default(defaults.runtime.status)
  })
  const brainMemoryInsideSchema = humanBrainMemoryInsideSchema.extend({
    facts: humanBrainMemoryInsideSchema.shape.facts.default(() => [...defaults.brainMemory.inside.facts]),
    evidences: humanBrainMemoryInsideSchema.shape.evidences.default(
      () => [...defaults.brainMemory.inside.evidences]
    ),
    openQuestions: humanBrainMemoryInsideSchema.shape.openQuestions.default(
      () => [...defaults.brainMemory.inside.openQuestions]
    )
  })
  const brainMemoryOutsideSchema = humanBrainMemoryOutsideSchema.extend({
    skillCatalog: humanBrainMemoryOutsideSchema.shape.skillCatalog.default(
      () => [...defaults.brainMemory.outside.skillCatalog]
    ),
    learnedSkillIds: humanBrainMemoryOutsideSchema.shape.learnedSkillIds.default(
      () => [...defaults.brainMemory.outside.learnedSkillIds]
    ),
    brainDecisions: humanBrainMemoryOutsideSchema.shape.brainDecisions.default(
      () => [...defaults.brainMemory.outside.brainDecisions]
    )
  })
  const brainMemorySchema = humanBrainMemorySchema.extend({
    inside: brainMemoryInsideSchema.default(() => ({
      facts: [...defaults.brainMemory.inside.facts],
      evidences: [...defaults.brainMemory.inside.evidences],
      openQuestions: [...defaults.brainMemory.inside.openQuestions]
    })),
    outside: brainMemoryOutsideSchema.default(() => ({
      skillCatalog: [...defaults.brainMemory.outside.skillCatalog],
      learnedSkillIds: [...defaults.brainMemory.outside.learnedSkillIds],
      brainDecisions: [...defaults.brainMemory.outside.brainDecisions]
    }))
  })
  const traceSchema = humanTraceSchema.extend({
    steps: humanTraceSchema.shape.steps.default(() => [...defaults.trace.steps])
  })

  return new StateSchema({
    task: humanTaskInputSchema.default(() => ({ ...defaults.task })),
    runtime: runtimeSchema.default(() => ({ ...defaults.runtime })),
    brainMemory: brainMemorySchema.default(() => ({
      inside: {
        facts: [...defaults.brainMemory.inside.facts],
        evidences: [...defaults.brainMemory.inside.evidences],
        openQuestions: [...defaults.brainMemory.inside.openQuestions]
      },
      outside: {
        skillCatalog: [...defaults.brainMemory.outside.skillCatalog],
        learnedSkillIds: [...defaults.brainMemory.outside.learnedSkillIds],
        brainDecisions: [...defaults.brainMemory.outside.brainDecisions]
      }
    })),
    lastParallelCallToolResults: humanStateContractSchema.shape.lastParallelCallToolResults,
    lastBrainDecision: humanStateContractSchema.shape.lastBrainDecision,
    watchHint: humanStateContractSchema.shape.watchHint,
    runtimeArtifacts: humanStateContractSchema.shape.runtimeArtifacts.default(
      () => [...defaults.runtimeArtifacts]
    ),
    result: humanStateContractSchema.shape.result,
    trace: traceSchema.default(() => ({
      steps: [...defaults.trace.steps]
    }))
  })
}
