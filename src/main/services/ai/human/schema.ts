import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import { aiArtifactRefSchema } from '../schema'
import {
  AI_TOOL_FAMILY_IDS,
  HUMAN_HAND_PLAN_INVALID_REASONS,
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_SKILL_SOURCES,
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  HUMAN_TOOL_USE_PLAN_MODES,
  HUMAN_WATCH_HINT_CODES,
  RUNTIME_SKILL_IDS,
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
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
export const humanToolUsePlanModeSchema = z.enum(HUMAN_TOOL_USE_PLAN_MODES)
export const humanHandPlanInvalidReasonSchema = z.enum(HUMAN_HAND_PLAN_INVALID_REASONS)
export const humanWatchHintCodeSchema = z.enum(HUMAN_WATCH_HINT_CODES)
export const humanSkillSourceSchema = z.enum(HUMAN_SKILL_SOURCES)
export const humanRoundExecutionKindSchema = z.enum(HUMAN_ROUND_EXECUTION_KINDS)

export const humanTaskInputSchema = z.object({
  taskId: z.string(),
  userInput: z.string()
})

export const skillDefinitionBaseSchema = z.object({
  skillId: runtimeSkillIdSchema,
  familyId: toolFamilyIdSchema,
  source: humanSkillSourceSchema,
  countsTowardToolBudget: z.boolean(),
  title: z.string().min(1),
  description: z.string().min(1),
  toolNames: z.array(z.string().min(1)),
  whenToUse: z.string().min(1)
})

export const toolCallParamSchema = z.object({
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

export const toolCallDiagnosticSchema = z.object({
  message: z.string().min(1)
})

export const toolResourceContextSchema = z.object({
  family: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  currentRevisionRef: z.string().min(1).optional(),
  previousRevisionRef: z.string().min(1).optional(),
  effectKind: z.string().min(1).optional()
})

export const toolCallResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  code: toolCallResultCodeSchema,
  data: jsonValueSchema.optional(),
  diagnostic: toolCallDiagnosticSchema.optional(),
  resourceContext: toolResourceContextSchema.optional()
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
    code: z.literal('hand_docx_positioned_write_blocked'),
    detail: z.object({
      targetDescription: z.string().min(1)
    })
  }),
  z.object({
    code: z.literal('brain_invalid_mouth_transition'),
    detail: z.object({})
  })
])

export const humanHistoryToolResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  code: toolCallResultCodeSchema,
  summary: z.string().min(1),
  data: jsonValueSchema.optional(),
  diagnosticText: z.string().optional(),
  artifactRefs: z.array(aiArtifactRefSchema).optional(),
  resourceContext: toolResourceContextSchema.optional()
})

export const humanStableMemorySchema = z.object({
  currentUnderstanding: z.string(),
  keyEvidence: z.string(),
  checklist: z.string()
})

export const humanStableMemoryPatchSchema = humanStableMemorySchema.partial()

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

export const humanDecisionSchema = z.object({
  updatedStableMemory: humanStableMemoryPatchSchema.optional(),
  decision: brainDecisionSchema,
  readyToDeliver: z.boolean(),
  nextAction: brainNextActionSchema
})

export const humanDeliveryPayloadSchema = z.object({
  summary: z.string().min(1),
  deliveryMarkdown: z.string().default('')
})

export const mouthOutputSchema = humanDeliveryPayloadSchema

export const runtimeChangedFileSchema = z.object({
  file_name: z.string().min(1),
  source_path: z.string().min(1),
  format: z.literal('docx'),
  change_count: z.number().int().min(0),
  summary: z.string().min(1),
  change_highlights: z.array(z.string().min(1)),
  draft_artifact_path: z.string().min(1).optional()
})

export const runtimeArtifactsSummarySchema = z.object({
  changed_files: z.array(runtimeChangedFileSchema)
})

export const humanResultSchema = humanDeliveryPayloadSchema.extend({
  status: z.literal('completed'),
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const humanTaskOutputSchema = humanDeliveryPayloadSchema.extend({
  taskId: z.string(),
  status: z.literal('completed'),
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const humanExecutionSchema = z.object({
  stage: humanStageSchema,
  status: humanStatusSchema,
  currentDecision: humanDecisionSchema.optional(),
  watchHint: humanWatchHintSchema.optional(),
  deliveryGuidance: z.string().min(1).optional(),
  lastToolResults: z.array(toolCallResultSchema).optional(),
  lastLearningOutcome: humanLearningOutcomeSchema.optional(),
  artifacts: z.array(aiArtifactRefSchema),
  runtimeArtifacts: runtimeArtifactsSummarySchema.optional()
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
  decision: humanDecisionSchema,
  execution: humanRoundExecutionSchema
})

export const historySearchFilterSchema = z.object({
  query: z.string().min(1).optional(),
  startRoundId: z.number().int().min(1).optional(),
  endRoundId: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional()
})

export const humanLoadedHistoryContextSchema = z.object({
  filters: historySearchFilterSchema,
  rounds: z.array(humanRoundRecordSchema)
})

export const humanMemoryHistorySchema = z.object({
  roundHistory: z.array(humanRoundRecordSchema),
  loadedHistoryContext: humanLoadedHistoryContextSchema.optional()
})

export const humanMemorySchema = z.object({
  stable: humanStableMemorySchema,
  history: humanMemoryHistorySchema
})

export const humanSkillsSchema = z.object({
  learnedSkillIds: z.array(runtimeSkillIdSchema)
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
  execution: humanExecutionSchema,
  memory: humanMemorySchema,
  skills: humanSkillsSchema,
  result: humanResultSchema.optional(),
  trace: humanTraceSchema
})
