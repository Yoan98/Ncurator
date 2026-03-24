import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import { aiArtifactRefSchema } from '../schema'
import {
  AI_TOOL_FAMILY_IDS,
  HUMAN_DELIVERY_MODES,
  HUMAN_FINAL_STATUSES,
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  TOOL_CALL_RESULT_CODES
} from './constants'

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

export const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
export const toolFamilyIdSchema = z.enum(AI_TOOL_FAMILY_IDS)
export const toolCallResultCodeSchema = z.enum(TOOL_CALL_RESULT_CODES)
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
export const humanFinalStatusSchema = z.enum(HUMAN_FINAL_STATUSES)
export const humanDeliveryModeSchema = z.enum(HUMAN_DELIVERY_MODES)

export const humanTaskInputSchema = z.object({
  taskId: z.string(),
  userInput: z.string()
})

export const skillCatalogItemSchema = z.object({
  skillId: runtimeSkillIdSchema,
  familyId: toolFamilyIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  toolNames: z.array(z.string().min(1)),
  whenToUse: z.string().min(1)
})

export const brainFactSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  evidenceIds: z.array(z.string().min(1))
})

export const brainEvidenceSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  summary: z.string().min(1),
  sourceType: z.literal('tool_result'),
  rawRef: z.string().min(1).optional()
})

export const toolCallParamSchema = z.object({
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

export const toolCallResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  code: toolCallResultCodeSchema,
  summary: z.string().min(1),
  data: jsonValueSchema.optional()
})

export const brainMemoryOpSchema = z.union([
  z.object({
    op: z.literal('add'),
    field: z.literal('facts'),
    value: brainFactSchema
  }),
  z.object({
    op: z.literal('edit'),
    field: z.literal('facts'),
    index: z.number().int().min(0),
    value: brainFactSchema
  }),
  z.object({
    op: z.literal('add'),
    field: z.literal('evidences'),
    value: brainEvidenceSchema
  }),
  z.object({
    op: z.literal('edit'),
    field: z.literal('evidences'),
    index: z.number().int().min(0),
    value: brainEvidenceSchema
  }),
  z.object({
    op: z.literal('add'),
    field: z.literal('openQuestions'),
    value: z.string().min(1)
  }),
  z.object({
    op: z.literal('edit'),
    field: z.literal('openQuestions'),
    index: z.number().int().min(0),
    value: z.string().min(1)
  }),
  z.object({
    op: z.literal('remove'),
    field: z.enum(['facts', 'evidences', 'openQuestions']),
    index: z.number().int().min(0)
  })
])

export const brainDecisionSchema = z.object({
  summary: z.string().min(1),
  reason: z.string().min(1),
  expectedOutcome: z.string().min(1)
})

export const brainNextActionSchema = z.union([
  z.object({
    action: z.literal('learning'),
    wantLearnSkillIds: z.array(runtimeSkillIdSchema).min(1)
  }),
  z.object({
    action: z.literal('hand'),
    parallelCallToolParam: z.array(toolCallParamSchema).min(1)
  }),
  z.object({
    action: z.literal('mouth'),
    status: humanFinalStatusSchema
  })
])

export const lastBrainDecisionSchema = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  nextAction: brainNextActionSchema
})

export const brainDecisionRecordSchema = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  nextAction: brainNextActionSchema,
  createdAt: z.number()
})

export const humanDeliveryPayloadSchema = z.object({
  summary: z.string().min(1),
  deliveryMarkdown: z.string().min(1).optional()
})

export const mouthOutputSchema = humanDeliveryPayloadSchema

export const humanResultSchema = humanDeliveryPayloadSchema.extend({
  status: humanFinalStatusSchema,
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const humanTaskOutputSchema = humanDeliveryPayloadSchema.extend({
  taskId: z.string(),
  status: humanFinalStatusSchema,
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const humanRuntimeSchema = z.object({
  stage: humanStageSchema,
  status: humanStatusSchema
})

export const humanBrainMemoryInsideSchema = z.object({
  facts: z.array(brainFactSchema),
  evidences: z.array(brainEvidenceSchema),
  openQuestions: z.array(z.string())
})

export const humanBrainMemoryOutsideSchema = z.object({
  skillCatalog: z.array(skillCatalogItemSchema),
  learnedSkillIds: z.array(runtimeSkillIdSchema),
  brainDecisions: z.array(brainDecisionRecordSchema)
})

export const humanBrainMemorySchema = z.object({
  inside: humanBrainMemoryInsideSchema,
  outside: humanBrainMemoryOutsideSchema
})

export const humanTraceStepSchema = z.object({
  step: z.number(),
  action: z.enum(HUMAN_STEP_ACTIONS),
  publicNarrative: z.string(),
  resultStatus: z.enum(HUMAN_STEP_RESULT_STATUSES).optional(),
  skillId: runtimeSkillIdSchema.optional(),
  toolName: z.string().optional(),
  summary: z.string()
})

export const humanTraceSchema = z.object({
  steps: z.array(humanTraceStepSchema)
})

export const humanStateContractSchema = z.object({
  task: humanTaskInputSchema,
  runtime: humanRuntimeSchema,
  brainMemory: humanBrainMemorySchema,
  lastParallelCallToolResults: z.array(toolCallResultSchema).optional(),
  lastBrainDecision: lastBrainDecisionSchema.optional(),
  watchHint: z.string().optional(),
  runtimeArtifacts: z.array(aiArtifactRefSchema),
  result: humanResultSchema.optional(),
  trace: humanTraceSchema
})
