import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import { aiArtifactRefSchema } from '../schema'
import {
  AI_TOOL_FAMILY_IDS,
  HUMAN_SKILL_AVAILABILITIES,
  HUMAN_SKILL_SOURCES,
  HUMAN_DELIVERY_MODES,
  HUMAN_HAND_PLAN_INVALID_REASONS,
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  HUMAN_TOOL_USE_PLAN_MODES,
  HUMAN_WATCH_HINT_CODES,
  RUNTIME_SKILL_IDS,
  TOOL_CALL_DIAGNOSTIC_KINDS,
  TOOL_CALL_RESULT_CODES
} from './constants'

export const jsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.object({}).catchall(jsonValueSchema)
)

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), jsonObjectSchema])
)

export const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
export const toolFamilyIdSchema = z.enum(AI_TOOL_FAMILY_IDS)
export const toolCallResultCodeSchema = z.enum(TOOL_CALL_RESULT_CODES)
export const toolCallDiagnosticKindSchema = z.enum(TOOL_CALL_DIAGNOSTIC_KINDS)
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
export const humanDeliveryModeSchema = z.enum(HUMAN_DELIVERY_MODES)
export const humanToolUsePlanModeSchema = z.enum(HUMAN_TOOL_USE_PLAN_MODES)
export const humanHandPlanInvalidReasonSchema = z.enum(HUMAN_HAND_PLAN_INVALID_REASONS)
export const humanWatchHintCodeSchema = z.enum(HUMAN_WATCH_HINT_CODES)
export const humanSkillSourceSchema = z.enum(HUMAN_SKILL_SOURCES)
export const humanSkillAvailabilitySchema = z.enum(HUMAN_SKILL_AVAILABILITIES)
export const humanRoundExecutionKindSchema = z.enum(HUMAN_ROUND_EXECUTION_KINDS)

export const humanTaskInputSchema = z.object({
  taskId: z.string(),
  userInput: z.string()
})

export const skillCatalogItemSchema = z.object({
  skillId: runtimeSkillIdSchema,
  familyId: toolFamilyIdSchema,
  source: humanSkillSourceSchema,
  availability: humanSkillAvailabilitySchema,
  countsTowardToolBudget: z.boolean(),
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
  rawRef: z.string().default('')
})

export const toolCallParamSchema = z.object({
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

export const toolCallDiagnosticSchema = z.object({
  kind: toolCallDiagnosticKindSchema,
  missingArgs: z.array(z.string().min(1)).optional()
})

export const toolCallResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  code: toolCallResultCodeSchema,
  data: jsonValueSchema.optional(),
  diagnostic: toolCallDiagnosticSchema.optional()
})

export const toolUsePlanSchema = z.object({
  mode: humanToolUsePlanModeSchema,
  calls: z.array(toolCallParamSchema).min(1)
})

export const humanLearningOutcomeSchema = z.object({
  requestedSkillIds: z.array(z.string().min(1)),
  loadedSkillIds: z.array(runtimeSkillIdSchema),
  skippedDuplicateSkillIds: z.array(runtimeSkillIdSchema),
  skippedUnknownSkillIds: z.array(z.string().min(1)),
  evictedSkillIds: z.array(runtimeSkillIdSchema),
  activeToolCount: z.number().int().min(0)
})

export const humanWatchHintSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('learning_no_effect'),
    detail: z.object({
      requestedSkillIds: z.array(z.string().min(1)),
      duplicateSkillIds: z.array(runtimeSkillIdSchema),
      unknownSkillIds: z.array(z.string().min(1))
    })
  }),
  z.object({
    code: z.literal('learning_tool_budget_exceeded'),
    detail: z.object({
      requestedSkillIds: z.array(z.string().min(1)),
      activeToolCount: z.number().int().min(0),
      limit: z.number().int().min(1)
    })
  }),
  z.object({
    code: z.literal('hand_plan_invalid'),
    detail: z.object({
      mode: humanToolUsePlanModeSchema,
      reason: humanHandPlanInvalidReasonSchema,
      offendingToolNames: z.array(z.string().min(1)),
      callCount: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional()
    })
  }),
  z.object({
    code: z.literal('hand_tool_limit_exceeded'),
    detail: z.object({
      toolCallCount: z.number().int().min(0),
      limit: z.number().int().min(1)
    })
  }),
  z.object({
    code: z.literal('brain_invalid_mouth_transition'),
    detail: z.object({})
  }),
  z.object({
    code: z.literal('memory_invalid_op'),
    detail: z.object({})
  })
])

export const humanHistoryToolResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  code: toolCallResultCodeSchema,
  summary: z.string().min(1),
  dataPreview: z.string().optional(),
  diagnosticText: z.string().optional(),
  artifactRefs: z.array(aiArtifactRefSchema).optional()
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
    wantLearnSkillIds: z.array(z.string().min(1)).min(1)
  }),
  z.object({
    action: z.literal('hand'),
    toolUsePlan: toolUsePlanSchema
  }),
  z.object({
    action: z.literal('mouth')
  })
])

export const lastBrainDecisionSchema = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  readyToDeliver: z.boolean(),
  nextAction: brainNextActionSchema
})

export const brainDecisionRecordSchema = z.object({
  memoryOps: z.array(brainMemoryOpSchema),
  decision: brainDecisionSchema,
  readyToDeliver: z.boolean(),
  nextAction: brainNextActionSchema,
  createdAt: z.number()
})

export const humanDeliveryPayloadSchema = z.object({
  summary: z.string().min(1),
  deliveryMarkdown: z.string().default('')
})

export const mouthOutputSchema = humanDeliveryPayloadSchema

export const humanResultSchema = humanDeliveryPayloadSchema.extend({
  status: z.literal('completed'),
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const humanTaskOutputSchema = humanDeliveryPayloadSchema.extend({
  taskId: z.string(),
  status: z.literal('completed'),
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

export const humanRoundExecutionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pre_execution_blocked'),
    watchHint: humanWatchHintSchema
  }),
  z.object({
    kind: z.literal('learning'),
    learningOutcome: humanLearningOutcomeSchema,
    watchHint: humanWatchHintSchema.optional()
  }),
  z.object({
    kind: z.literal('hand'),
    toolUsePlan: toolUsePlanSchema,
    toolResults: z.array(humanHistoryToolResultSchema),
    watchHint: humanWatchHintSchema.optional(),
    artifactRefs: z.array(aiArtifactRefSchema).optional()
  }),
  z.object({
    kind: z.literal('mouth'),
    summary: z.string().min(1),
    completed: z.boolean()
  })
])

export const humanRoundRecordSchema = z.object({
  roundId: z.number().int().min(1),
  createdAt: z.number(),
  decision: lastBrainDecisionSchema,
  execution: humanRoundExecutionSchema
})

export const historyRecallFilterSchema = z.object({
  roundIds: z.array(z.number().int().min(1)).optional(),
  executionKinds: z.array(humanRoundExecutionKindSchema).optional(),
  toolNames: z.array(z.string().min(1)).optional(),
  watchHintCodes: z.array(humanWatchHintCodeSchema).optional(),
  limit: z.number().int().min(1).optional()
})

export const humanLoadedHistoryContextSchema = z.object({
  filters: historyRecallFilterSchema,
  rounds: z.array(humanRoundRecordSchema)
})

export const humanProcessMemorySchema = z.object({
  roundHistory: z.array(humanRoundRecordSchema),
  loadedHistoryContext: humanLoadedHistoryContextSchema.optional()
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
  processMemory: humanProcessMemorySchema,
  lastToolUseResults: z.array(toolCallResultSchema).optional(),
  lastLearningOutcome: humanLearningOutcomeSchema.optional(),
  lastBrainDecision: lastBrainDecisionSchema.optional(),
  watchHint: humanWatchHintSchema.optional(),
  runtimeArtifacts: z.array(aiArtifactRefSchema),
  result: humanResultSchema.optional(),
  trace: humanTraceSchema
})
