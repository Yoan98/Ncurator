import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { JsonValue } from '../../../../../shared/types'
import { RUNTIME_SKILL_IDS, TOOL_CALL_RESULT_CODES } from '../constants'
import type { HumanTaskInput } from '../types'

export const createHumanRunStateSchema = () => {
  const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
  const toolFamilyIdSchema = z.enum(['terminal', 'kb', 'docx'])
  const toolCallResultCodeSchema = z.enum(TOOL_CALL_RESULT_CODES)
  const humanTaskInputSchema: z.ZodType<HumanTaskInput> = z.object({
    taskId: z.string(),
    userInput: z.string()
  })

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
            facts: z
              .array(
                z.object({
                  id: z.string(),
                  summary: z.string(),
                  evidenceIds: z.array(z.string())
                })
              )
              .default(() => []),
            evidences: z
              .array(
                z.object({
                  id: z.string(),
                  toolName: z.string(),
                  summary: z.string(),
                  sourceType: z.literal('tool_result'),
                  rawRef: z.string().optional()
                })
              )
              .default(() => []),
            openQuestions: z.array(z.string()).default(() => [])
          })
          .default(() => ({
            facts: [],
            evidences: [],
            openQuestions: []
          })),
        outside: z
          .object({
            skillCatalog: z
              .array(
                z.object({
                  skillId: runtimeSkillIdSchema,
                  familyId: toolFamilyIdSchema,
                  title: z.string(),
                  summary: z.string(),
                  toolNames: z.array(z.string()),
                  whenToUse: z.string()
                })
              )
              .default(() => []),
            learnedSkillIds: z.array(runtimeSkillIdSchema).default(() => []),
            brainDecisions: z
              .array(
                z.object({
                  memoryOps: z.array(z.record(z.string(), jsonValueSchema)).default(() => []),
                  decision: z.object({
                    summary: z.string(),
                    reason: z.string(),
                    expectedOutcome: z.string()
                  }),
                  nextAction: z.record(z.string(), jsonValueSchema),
                  createdAt: z.number()
                })
              )
              .default(() => [])
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
    lastParallelCallToolResults: z
      .array(
        z.object({
          toolName: z.string(),
          ok: z.boolean(),
          code: toolCallResultCodeSchema,
          summary: z.string(),
          data: jsonValueSchema.optional()
        })
      )
      .optional(),
    lastBrainDecision: z
      .object({
        memoryOps: z.array(z.record(z.string(), jsonValueSchema)).default(() => []),
        decision: z.object({
          summary: z.string(),
          reason: z.string(),
          expectedOutcome: z.string()
        }),
        nextAction: z.record(z.string(), jsonValueSchema)
      })
      .optional(),
    watchHint: z.string().optional(),
    result: z
      .object({
        status: z.enum(['completed', 'blocked']),
        summary: z.string(),
        deliveryMarkdown: z.string().optional()
      })
      .optional(),
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
