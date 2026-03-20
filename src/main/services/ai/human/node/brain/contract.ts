import { z } from 'zod/v4'
import type {
  EvidenceRef,
  HumanActionBatch,
  HumanActionSpec,
  HumanMemoryPatch,
  HumanOutcome,
  HumanReasoningOutput,
  HumanState,
  RuntimeSkillId
} from '../../types'
import { RUNTIME_SKILL_IDS } from '../../constants'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'

const clipText = (value: string, maxChars = 240): string => {
  const text = String(value || '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 3)}...`
}

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
const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)

const evidenceRefSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['tool_result', 'user_input', 'prior_delivery']),
    summary: z.string(),
    toolName: z.string().optional(),
    sourceRef: z.string().optional()
  })
  .strict()

const humanFactSchema = z
  .object({
    id: z.string(),
    summary: z.string(),
    evidenceIds: z.array(z.string()).default(() => [])
  })
  .strict()

const memoryPatchSchema = z
  .object({
    constraints: z.array(z.string()).optional(),
    facts: z.array(humanFactSchema).optional(),
    evidence: z.array(evidenceRefSchema).optional(),
    openQuestions: z.array(z.string()).optional(),
    focus: z
      .object({
        current: z.union([z.string(), z.null()]).optional()
      })
      .strict()
      .optional()
  })
  .strict()

const activateCapabilityActionSchema = z
  .object({
    type: z.literal('activate_capability'),
    skillId: runtimeSkillIdSchema,
    rationale: z.string(),
    publicNarrative: z.string()
  })
  .strict()

const invokeToolActionSchema = z
  .object({
    type: z.literal('invoke_tool'),
    toolName: z.string(),
    args: jsonObjectSchema,
    rationale: z.string(),
    publicNarrative: z.string()
  })
  .strict()

const humanActionSpecSchema = z.discriminatedUnion('type', [
  activateCapabilityActionSchema,
  invokeToolActionSchema
])

const humanActionBatchSchema = z
  .object({
    summary: z.string(),
    actions: z.array(humanActionSpecSchema).min(1).max(4)
  })
  .strict()

const humanOutcomeSchema = z
  .object({
    status: z.enum(['completed', 'blocked']),
    summary: z.string(),
    payload: jsonObjectSchema.optional()
  })
  .strict()

const humanReasoningOutputSchema = z
  .object({
    memoryPatch: memoryPatchSchema,
    analysis: z
      .object({
        summary: z.string()
      })
      .strict(),
    actionBatch: humanActionBatchSchema.optional(),
    outcome: humanOutcomeSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasActionBatch = value.actionBatch !== undefined
    const hasOutcome = value.outcome !== undefined
    if (hasActionBatch === hasOutcome) {
      ctx.addIssue({
        code: 'custom',
        message: '必须且只能输出 actionBatch 或 outcome 其中之一。'
      })
    }
  })

const normalizeUniqueStrings = (values: string[] | undefined): string[] | undefined => {
  if (!values) return undefined
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)))
}

const normalizeEvidence = (evidence: EvidenceRef[] | undefined): EvidenceRef[] | undefined => {
  if (!evidence) return undefined
  const seen = new Set<string>()
  const next: EvidenceRef[] = []
  for (const item of evidence) {
    const id = String(item.id || '').trim()
    const summary = clipText(item.summary, 240)
    if (!id || !summary || seen.has(id)) continue
    seen.add(id)
    next.push({
      id,
      kind: item.kind,
      summary,
      toolName: item.toolName ? String(item.toolName).trim() || undefined : undefined,
      sourceRef: item.sourceRef ? String(item.sourceRef).trim() || undefined : undefined
    })
  }
  return next
}

const normalizeFacts = (input: {
  facts: HumanMemoryPatch['facts']
  validEvidenceIds: Set<string>
}): HumanMemoryPatch['facts'] => {
  if (!input.facts) return undefined
  const seen = new Set<string>()
  const next = input.facts
    .map((fact) => {
      const id = String(fact.id || '').trim()
      const summary = clipText(fact.summary, 240)
      const evidenceIds = Array.from(
        new Set(
          fact.evidenceIds
            .map((item) => String(item || '').trim())
            .filter((item) => Boolean(item) && input.validEvidenceIds.has(item))
        )
      )
      if (!id || !summary || evidenceIds.length === 0 || seen.has(id)) return null
      seen.add(id)
      return {
        id,
        summary,
        evidenceIds
      }
    })
    .filter((item): item is { id: string; summary: string; evidenceIds: string[] } => item !== null)

  return next
}

const normalizeAction = (action: HumanActionSpec): HumanActionSpec => {
  if (action.type === 'activate_capability') {
    return {
      ...action,
      skillId: action.skillId as RuntimeSkillId,
      rationale: clipText(action.rationale, 400) || '需要先激活能力再继续执行。',
      publicNarrative: clipText(action.publicNarrative, 200) || '我先激活当前所需能力。'
    }
  }

  return {
    ...action,
    toolName: String(action.toolName || '').trim(),
    args: action.args || {},
    rationale: clipText(action.rationale, 400) || '需要调用工具来推进任务。',
    publicNarrative: clipText(action.publicNarrative, 200) || '我会继续获取完成任务所需的信息。'
  }
}

export const normalizeActionBatch = (actionBatch: HumanActionBatch): HumanActionBatch => {
  return {
    summary: clipText(actionBatch.summary, 300) || '继续推进当前任务。',
    actions: actionBatch.actions.map((action) => normalizeAction(action)).slice(0, 4)
  }
}

export const normalizeOutcome = (outcome: HumanOutcome): HumanOutcome => {
  return {
    status: outcome.status,
    summary: clipText(outcome.summary, 500) || '任务已结束。',
    payload: outcome.payload
  }
}

const normalizeMemoryPatch = (input: {
  patch: HumanMemoryPatch
  state: HumanState
}): HumanMemoryPatch => {
  const normalizedEvidence = normalizeEvidence(input.patch.evidence)
  const validEvidenceIds = new Set<string>([
    ...input.state.memory.evidence.map((item) => item.id),
    ...(input.state.turn.incoming?.observations.map((item) => item.id) || []),
    ...(normalizedEvidence?.map((item) => item.id) || [])
  ])

  return {
    constraints: normalizeUniqueStrings(input.patch.constraints),
    facts: normalizeFacts({
      facts: input.patch.facts,
      validEvidenceIds
    }),
    evidence: normalizedEvidence,
    openQuestions: normalizeUniqueStrings(input.patch.openQuestions),
    focus:
      input.patch.focus && 'current' in input.patch.focus
        ? {
            current: input.patch.focus.current ? clipText(input.patch.focus.current, 200) : null
          }
        : undefined
  }
}

const buildInvalidContractOutput = (reason: string): HumanReasoningOutput => {
  const summary = clipText(reason, 320) || 'reason contract invalid'
  return {
    memoryPatch: {},
    analysis: {
      summary: `reason contract invalid: ${summary}`
    },
    outcome: {
      status: 'blocked',
      summary: `reason contract invalid: ${summary}`
    }
  }
}

export const parseReasonOutput = (input: {
  rawOutput: HumanReasoningOutput | JsonObject | object
  state: HumanState
}): HumanReasoningOutput => {
  const parsed = humanReasoningOutputSchema.safeParse(input.rawOutput)
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
        return `${path}: ${issue.message}`
      })
      .join('; ')
    return buildInvalidContractOutput(summary)
  }

  const normalizedMemoryPatch = normalizeMemoryPatch({
    patch: parsed.data.memoryPatch,
    state: input.state
  })
  const normalizedAnalysis = {
    summary: clipText(parsed.data.analysis.summary, 400) || '继续评估当前任务状态。'
  }

  if (parsed.data.outcome) {
    return {
      memoryPatch: normalizedMemoryPatch,
      analysis: normalizedAnalysis,
      outcome: normalizeOutcome(parsed.data.outcome)
    }
  }

  if (!parsed.data.actionBatch || parsed.data.actionBatch.actions.length === 0) {
    return buildInvalidContractOutput('actionBatch 不能为空。')
  }

  return {
    memoryPatch: normalizedMemoryPatch,
    analysis: normalizedAnalysis,
    actionBatch: normalizeActionBatch(parsed.data.actionBatch)
  }
}
