import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import { aiArtifactRefSchema } from '../../schema'
import { HUMAN_STEP_ACTIONS, HUMAN_STEP_RESULT_STATUSES } from '../constants'
import {
  brainDecisionRecordSchema,
  brainEvidenceSchema,
  brainFactSchema,
  humanStageSchema,
  humanStatusSchema,
  humanResultSchema,
  humanTaskInputSchema,
  lastBrainDecisionSchema,
  runtimeSkillIdSchema,
  skillCatalogItemSchema,
  toolCallResultSchema
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

  return new StateSchema({
    task: humanTaskInputSchema.default(defaultTask),
    runtime: z
      .object({
        stage: humanStageSchema.default(defaultRuntime().stage),
        status: humanStatusSchema.default(defaultRuntime().status)
      })
      .default(defaultRuntime),
    brainMemory: z
      .object({
        inside: z
          .object({
            facts: z.array(brainFactSchema).default(() => []),
            evidences: z.array(brainEvidenceSchema).default(() => []),
            openQuestions: z.array(z.string()).default(() => [])
          })
          .default(() => defaultBrainMemory().inside),
        outside: z
          .object({
            skillCatalog: z
              .array(skillCatalogItemSchema)
              .default(() => defaultBrainMemory().outside.skillCatalog),
            learnedSkillIds: z.array(runtimeSkillIdSchema).default(() => []),
            brainDecisions: z.array(brainDecisionRecordSchema).default(() => [])
          })
          .default(() => defaultBrainMemory().outside)
      })
      .default(defaultBrainMemory),
    lastParallelCallToolResults: z.array(toolCallResultSchema).optional(),
    lastBrainDecision: lastBrainDecisionSchema.optional(),
    watchHint: z.string().optional(),
    runtimeArtifacts: z.array(aiArtifactRefSchema).default(() => []),
    result: humanResultSchema.optional(),
    trace: z
      .object({
        steps: z
          .array(
            z.object({
              step: z.number(),
              action: z.enum(HUMAN_STEP_ACTIONS),
              publicNarrative: z.string(),
              resultStatus: z.enum(HUMAN_STEP_RESULT_STATUSES).optional(),
              skillId: runtimeSkillIdSchema.optional(),
              toolName: z.string().optional(),
              summary: z.string()
            })
          )
          .default(() => [])
      })
      .default(defaultTrace)
  })
}
