import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import { HUMAN_DELIVERY_MODES, RUNTIME_SKILL_IDS, TOOL_CALL_RESULT_CODES } from './constants'
import type {
  BrainDecision,
  BrainDecisionRecord,
  BrainEvidence,
  BrainFact,
  BrainMemoryOp,
  BrainNextAction,
  HumanDeliveryMode,
  HumanResult,
  HumanTaskInput,
  LastBrainDecision,
  MouthOutput,
  SkillCatalogItem,
  ToolCallParam,
  ToolCallResult
} from './types'

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
export const toolFamilyIdSchema = z.enum(['terminal', 'kb', 'docx'])
export const toolCallResultCodeSchema = z.enum(TOOL_CALL_RESULT_CODES)
export const humanDeliveryModeSchema: z.ZodType<HumanDeliveryMode> = z.enum(HUMAN_DELIVERY_MODES)

export const humanTaskInputSchema: z.ZodType<HumanTaskInput> = z.object({
  taskId: z.string(),
  userInput: z.string()
})

export const skillCatalogItemSchema: z.ZodType<SkillCatalogItem> = z.object({
  skillId: runtimeSkillIdSchema,
  familyId: toolFamilyIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  toolNames: z.array(z.string().min(1)),
  whenToUse: z.string().min(1)
})

export const brainFactSchema: z.ZodType<BrainFact> = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  evidenceIds: z.array(z.string().min(1))
})

export const brainEvidenceSchema: z.ZodType<BrainEvidence> = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  summary: z.string().min(1),
  sourceType: z.literal('tool_result'),
  rawRef: z.string().min(1).optional()
})

export const toolCallParamSchema: z.ZodType<ToolCallParam> = z.object({
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

export const toolCallResultSchema: z.ZodType<ToolCallResult> = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  code: toolCallResultCodeSchema,
  summary: z.string().min(1),
  data: jsonValueSchema.optional()
})

export const brainMemoryOpSchema: z.ZodType<BrainMemoryOp> = z.union([
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

export const brainDecisionSchema: z.ZodType<BrainDecision> = z.object({
  summary: z.string().min(1),
  reason: z.string().min(1),
  expectedOutcome: z.string().min(1)
})

export const brainNextActionSchema: z.ZodType<BrainNextAction> = z.union([
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
    status: z.enum(['completed', 'blocked'])
  })
])

export const lastBrainDecisionSchema: z.ZodType<LastBrainDecision> = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  nextAction: brainNextActionSchema
})

export const brainDecisionRecordSchema: z.ZodType<BrainDecisionRecord> = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  nextAction: brainNextActionSchema,
  createdAt: z.number()
})

export const mouthOutputSchema: z.ZodType<MouthOutput> = z.object({
  summary: z.string().min(1),
  deliveryMarkdown: z.string().min(1).optional()
})

export const humanResultSchema: z.ZodType<HumanResult> = z.object({
  status: z.enum(['completed', 'blocked']),
  summary: z.string().min(1),
  deliveryMarkdown: z.string().min(1).optional()
})
