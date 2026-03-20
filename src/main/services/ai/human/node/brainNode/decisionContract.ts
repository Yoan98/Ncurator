import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'
import { RUNTIME_SKILL_IDS } from '../../constants'
import type {
  BrainDecision,
  BrainEvidence,
  BrainFact,
  BrainMemoryOp,
  BrainNextAction,
  LastBrainDecision,
  ToolCallParam
} from '../../types'

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

const brainFactSchema: z.ZodType<BrainFact> = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  evidenceIds: z.array(z.string().min(1))
})

const brainEvidenceSchema: z.ZodType<BrainEvidence> = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  summary: z.string().min(1),
  sourceType: z.literal('tool_result'),
  rawRef: z.string().min(1).optional()
})

const toolCallParamSchema: z.ZodType<ToolCallParam> = z.object({
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

const brainMemoryOpSchema: z.ZodType<BrainMemoryOp> = z.union([
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

const brainDecisionSchema: z.ZodType<BrainDecision> = z.object({
  summary: z.string().min(1),
  reason: z.string().min(1),
  expectedOutcome: z.string().min(1)
})

const brainNextActionSchema: z.ZodType<BrainNextAction> = z.union([
  z.object({
    action: z.literal('learning'),
    wantLearnSkillIds: z.array(z.enum(RUNTIME_SKILL_IDS)).min(1)
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

export const brainDecisionOutputSchema: z.ZodType<LastBrainDecision> = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  nextAction: brainNextActionSchema
})

export const parseBrainDecisionOutput = (rawOutput: LastBrainDecision): LastBrainDecision =>
  brainDecisionOutputSchema.parse(rawOutput)
