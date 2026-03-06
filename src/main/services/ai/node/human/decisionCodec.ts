import { z } from 'zod/v4'
import {
  RUNTIME_SKILL_IDS,
  type HumanStepDecision,
  type JsonObject,
  type JsonValue
} from '../../../../../shared/types'

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

export const humanStepDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('load_skill'),
    skillId: z.enum(RUNTIME_SKILL_IDS),
    rationale: z.string().min(1),
    publicNarrative: z.string().min(1)
  }),
  z.object({
    action: z.literal('invoke_tool'),
    toolName: z.string().min(1),
    args: jsonObjectSchema.default({}),
    rationale: z.string().min(1),
    publicNarrative: z.string().min(1)
  }),
  z.object({
    action: z.literal('complete_task'),
    summary: z.string().min(1),
    rationale: z.string().min(1),
    publicNarrative: z.string().min(1),
    resultData: jsonObjectSchema.optional()
  }),
  z.object({
    action: z.literal('block_task'),
    reason: z.string().min(1),
    rationale: z.string().min(1),
    publicNarrative: z.string().min(1),
    details: jsonValueSchema.optional()
  })
])

export const decodeHumanStepDecision = (raw: JsonObject): HumanStepDecision | null => {
  const parsed = humanStepDecisionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
