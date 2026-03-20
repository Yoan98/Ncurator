import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { HumanTaskInput } from '../types'
import { HUMAN_STEP_ACTIONS, HUMAN_STEP_RESULT_STATUSES, RUNTIME_SKILL_IDS } from '../constants'
import type { JsonObject, JsonValue } from '../../../../../shared/types'

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
  const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)
  const humanTaskInputSchema: z.ZodType<HumanTaskInput> = z.object({
    taskId: z.string(),
    objective: z.string()
  })
  const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
  const humanStepActionSchema = z.enum(HUMAN_STEP_ACTIONS)
  const humanStepResultStatusSchema = z.enum(HUMAN_STEP_RESULT_STATUSES)
  const humanFactSchema = z.object({
    id: z.string(),
    summary: z.string(),
    evidenceIds: z.array(z.string())
  })
  const evidenceRefSchema = z.object({
    id: z.string(),
    kind: z.enum(['tool_result', 'user_input', 'prior_delivery']),
    summary: z.string(),
    toolName: z.string().optional(),
    sourceRef: z.string().optional()
  })
  const humanFocusSchema = z.object({
    current: z.string().optional()
  })
  const humanActionSpecSchema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('activate_capability'),
      skillId: runtimeSkillIdSchema,
      rationale: z.string(),
      publicNarrative: z.string()
    }),
    z.object({
      type: z.literal('invoke_tool'),
      toolName: z.string(),
      args: jsonObjectSchema,
      rationale: z.string(),
      publicNarrative: z.string()
    })
  ])
  const humanStepRecordSchema = z.object({
    step: z.number(),
    action: humanStepActionSchema,
    publicNarrative: z.string(),
    resultStatus: humanStepResultStatusSchema.optional(),
    skillId: runtimeSkillIdSchema.optional(),
    toolName: z.string().optional(),
    summary: z.string()
  })
  const humanObservationSchema = z.discriminatedUnion('kind', [
    z.object({
      id: z.string(),
      kind: z.literal('capability_activated'),
      skillId: runtimeSkillIdSchema,
      summary: z.string()
    }),
    z.object({
      id: z.string(),
      kind: z.literal('tool_result'),
      toolName: z.string(),
      ok: z.boolean(),
      code: z.enum([
        'ok',
        'failed',
        'workspace_required',
        'approval_denied',
        'bounded_loop_error',
        'invalid_input'
      ]),
      summary: z.string(),
      data: jsonValueSchema.optional()
    })
  ])
  const observationBatchSchema = z.object({
    summary: z.string(),
    observations: z.array(humanObservationSchema).default(() => [])
  })
  const reasonAnalysisSchema = z.object({
    summary: z.string()
  })
  const humanActionBatchSchema = z.object({
    summary: z.string(),
    actions: z.array(humanActionSpecSchema).default(() => [])
  })
  const watchdogHintSchema = z.object({
    level: z.enum(['warn', 'stop']),
    summary: z.string(),
    signs: z.array(z.string()).default(() => []),
    shouldConverge: z.boolean().default(false)
  })
  const humanOutcomeSchema = z.object({
    status: z.enum(['completed', 'blocked']),
    summary: z.string(),
    payload: jsonObjectSchema.optional(),
    presentation: z
      .object({
        markdown: z.string()
      })
      .optional(),
    provenance: z
      .object({
        localSourceStatus: z.enum(['used', 'not_used', 'insufficient']).optional(),
        localSourceSummary: z.string().optional()
      })
      .optional()
  })

  return new StateSchema({
    task: z.object({
      taskId: z.string(),
      objective: z.string()
    }).default(() => humanTaskInputSchema.parse({ taskId: '', objective: '' })),
    progress: z.object({
      phase: z.enum(['reasoning', 'executing', 'finalizing']).default('reasoning'),
      maxParallel: z.number().default(2)
    }).default(() => ({ phase: 'reasoning' as const, maxParallel: 2 })),
    memory: z.object({
      constraints: z.array(z.string()).default(() => []),
      facts: z.array(humanFactSchema).default(() => []),
      evidence: z.array(evidenceRefSchema).default(() => []),
      openQuestions: z.array(z.string()).default(() => []),
      focus: humanFocusSchema.default(() => ({
        current: undefined
      })),
      capabilityFocus: z.object({
        activeStack: z.array(runtimeSkillIdSchema).default(() => [])
      }).default(() => ({ activeStack: [] }))
    }).default(() => ({
      constraints: [],
      facts: [],
      evidence: [],
      openQuestions: [],
      focus: {
        current: undefined
      },
      capabilityFocus: {
        activeStack: []
      }
    })),
    turn: z.object({
      incoming: observationBatchSchema.optional(),
      analysis: reasonAnalysisSchema.optional(),
      actionBatch: humanActionBatchSchema.optional(),
      watchdogHint: watchdogHintSchema.optional()
    }).default(() => ({})),
    outcome: humanOutcomeSchema.optional(),
    trace: z.object({
      steps: z.array(humanStepRecordSchema).default(() => [])
    }).default(() => ({ steps: [] }))
  })
}
