import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import { aiArtifactRefSchema } from '../../schema'
import {
  brainDecisionRecordSchema,
  brainEvidenceSchema,
  brainFactSchema,
  humanResultSchema,
  humanTaskInputSchema,
  lastBrainDecisionSchema,
  runtimeSkillIdSchema,
  skillCatalogItemSchema,
  toolCallResultSchema
} from '../schema'

export const createHumanRunStateSchema = () => {
  return new StateSchema({
    task: z
      .object({
        taskId: z.string(),
        userInput: z.string()
      })
      .default(() => humanTaskInputSchema.parse({ taskId: '', userInput: '' })),
    runtime: z
      .object({
        stage: z.enum(['brain', 'learning', 'hand', 'mouth']).default('brain'),
        status: z.enum(['running', 'completed', 'blocked']).default('running')
      })
      .default(() => ({
        stage: 'brain' as const,
        status: 'running' as const
      })),
    brainMemory: z
      .object({
        inside: z
          .object({
            facts: z.array(brainFactSchema).default(() => []),
            evidences: z.array(brainEvidenceSchema).default(() => []),
            openQuestions: z.array(z.string()).default(() => [])
          })
          .default(() => ({
            facts: [],
            evidences: [],
            openQuestions: []
          })),
        outside: z
          .object({
            skillCatalog: z.array(skillCatalogItemSchema).default(() => []),
            learnedSkillIds: z.array(runtimeSkillIdSchema).default(() => []),
            brainDecisions: z.array(brainDecisionRecordSchema).default(() => [])
          })
          .default(() => ({
            skillCatalog: [],
            learnedSkillIds: [],
            brainDecisions: []
          }))
      })
      .default(() => ({
        inside: {
          facts: [],
          evidences: [],
          openQuestions: []
        },
        outside: {
          skillCatalog: [],
          learnedSkillIds: [],
          brainDecisions: []
        }
      })),
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
              action: z.enum([
                'brain_decision',
                'learn_skill',
                'call_tool',
                'deliver_result',
                'block_result'
              ]),
              publicNarrative: z.string(),
              resultStatus: z.enum(['ok', 'error', 'blocked']).optional(),
              skillId: runtimeSkillIdSchema.optional(),
              toolName: z.string().optional(),
              summary: z.string()
            })
          )
          .default(() => [])
      })
      .default(() => ({ steps: [] }))
  })
}
