import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import { aiArtifactRefSchema } from '../schema'
import {
  AI_TOOL_FAMILY_IDS,
  BUILTIN_RUNTIME_SKILL_IDS,
  HUMAN_HAND_PLAN_INVALID_REASONS,
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_SKILL_SOURCES,
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  HUMAN_TOOL_USE_PLAN_LIMIT,
  HUMAN_TOOL_USE_PLAN_MODES,
  HUMAN_DECISION_HINT_CODES,
  RUNTIME_SKILL_IDS,
  TOOL_CALL_RESULT_CODES
} from './constants'

export const jsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.object({}).catchall(jsonValueSchema)
)

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    jsonObjectSchema
  ])
)

export const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
export const toolFamilyIdSchema = z.enum(AI_TOOL_FAMILY_IDS)
export const toolCallResultCodeSchema = z.enum(TOOL_CALL_RESULT_CODES)
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
export const humanToolUsePlanModeSchema = z.enum(HUMAN_TOOL_USE_PLAN_MODES)
export const humanHandPlanInvalidReasonSchema = z.enum(HUMAN_HAND_PLAN_INVALID_REASONS)
export const humanDecisionHintCodeSchema = z.enum(HUMAN_DECISION_HINT_CODES)
export const docxBatchHaltReasonSchema = z.enum([
  'ambiguous_successor',
  'ambiguous_table_cell',
  'anchor_deleted_unrecoverable',
  'layout_protection',
  'batch_write_limit_exceeded',
  'locator_confidence_too_low'
])
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

const serialToolUsePlanSchema = z.object({
  mode: z.literal('serial'),
  calls: z.array(toolCallParamSchema).min(1).max(HUMAN_TOOL_USE_PLAN_LIMIT)
})

const parallelToolUsePlanSchema = z.object({
  mode: z.literal('parallel'),
  calls: z.array(toolCallParamSchema).min(1).max(HUMAN_TOOL_USE_PLAN_LIMIT)
})

export const toolUsePlanSchema = z.discriminatedUnion('mode', [
  serialToolUsePlanSchema,
  parallelToolUsePlanSchema
])

export const humanLearningOutcomeSchema = z.object({
  requestedSkillIds: z.array(z.string().min(1)),
  loadedSkillIds: z.array(runtimeSkillIdSchema),
  skippedDuplicateSkillIds: z.array(runtimeSkillIdSchema),
  skippedUnknownSkillIds: z.array(z.string().min(1)),
  evictedSkillIds: z.array(runtimeSkillIdSchema),
  activeToolCount: z.number().int().min(0)
})

export const humanDecisionHintSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('learning_no_effect'),
    detail: z.object({
      requestedSkillIds: z.array(z.string().min(1)),
      duplicateSkillIds: z.array(runtimeSkillIdSchema),
      unknownSkillIds: z.array(z.string().min(1))
    })
  }),
  z.object({
    code: z.literal('learning_builtin_skill_requested'),
    detail: z.object({
      requestedSkillIds: z.array(z.string().min(1)),
      builtinSkillIds: z.array(z.enum(BUILTIN_RUNTIME_SKILL_IDS)).min(1)
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
    code: z.literal('hand_docx_batch_write_halted'),
    detail: z.object({
      sourcePath: z.string().min(1),
      lastSafeRevisionRef: z.string().min(1),
      haltedAtCallIndex: z.number().int().min(0),
      completedCallCount: z.number().int().min(0),
      totalCallCount: z.number().int().min(1),
      haltReason: docxBatchHaltReasonSchema,
      haltSummary: z.string().min(1),
      completedItems: z.array(z.string().min(1)),
      pendingItems: z.array(z.string().min(1)),
      failedItem: z.string().min(1),
      recoveryContext: z.string().min(1)
    })
  }),
  z.object({
    code: z.literal('docx_write_requires_readback'),
    detail: z.object({
      sourcePaths: z.array(z.string().min(1)),
      latestRevisionRefs: z.array(z.string().min(1))
    })
  }),
  z.object({
    code: z.literal('brain_todolist_incomplete'),
    detail: z.object({
      pendingItems: z.array(z.string().min(1)).min(1)
    })
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

export const humanTodoItemStatusSchema = z.enum(['todo', 'done', 'obsolete'])

export const humanTodoItemSchema = z.object({
  item: z.string().min(1),
  status: humanTodoItemStatusSchema
})

export const humanThoughtSchema = z.object({
  next: z.string().min(1),
  todolist: z.array(humanTodoItemSchema).optional(),
  progressionSummary: z.string().optional()
})

export const humanReferenceSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['internal', 'external']),
  usedFor: z.string().min(1)
})

export const brainNextActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('learning'),
      wantLearnSkillIds: z.array(z.string().min(1)).min(1)
    })
    .strict(),
  z
    .object({
      action: z.literal('hand'),
      toolUsePlan: toolUsePlanSchema
    })
    .strict(),
  z
    .object({
      action: z.literal('mouth'),
      references: z.array(humanReferenceSchema).optional()
    })
    .strict()
])

export const humanThoughtDecisionSchema = z.object({
  thought: humanThoughtSchema,
  nextAction: brainNextActionSchema
})

export const humanDeliveryPayloadSchema = z.object({
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

export const deliveryGuidanceItemSchema = z.object({
  source: z.literal('hand'),
  text: z.string().min(1)
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
  currentThought: humanThoughtDecisionSchema.optional(),
  pendingDecisionHint: humanDecisionHintSchema.optional(),
  deliveryGuidanceItems: z.array(deliveryGuidanceItemSchema).optional(),
  lastToolResults: z.array(toolCallResultSchema).optional(),
  lastLearningOutcome: humanLearningOutcomeSchema.optional(),
  artifacts: z.array(aiArtifactRefSchema),
  runtimeArtifacts: runtimeArtifactsSummarySchema.optional(),
  references: z.array(humanReferenceSchema).optional(),
  contextBudget: z
    .object({
      tokenEstimate: z.number().int().min(0),
      contextWindowTokens: z.number().int().min(1),
      triggerTokens: z.number().int().min(1)
    })
    .optional()
})

export const humanRoundExecutionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pre_execution_blocked'),
    decisionHint: humanDecisionHintSchema
  }),
  z.object({
    kind: z.literal('learning'),
    learningOutcome: humanLearningOutcomeSchema,
    decisionHint: humanDecisionHintSchema.optional()
  }),
  z.object({
    kind: z.literal('hand'),
    toolUsePlan: toolUsePlanSchema,
    toolResults: z.array(humanHistoryToolResultSchema),
    decisionHint: humanDecisionHintSchema.optional(),
    artifactRefs: z.array(aiArtifactRefSchema).optional()
  }),
  z.object({
    kind: z.literal('mouth'),
    completed: z.boolean()
  })
])

export const humanRoundRecordSchema = z.object({
  roundId: z.number().int().min(1),
  createdAt: z.number(),
  thought: humanThoughtDecisionSchema,
  execution: humanRoundExecutionSchema
})

export const humanCompactBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('rounds'),
  summary: z.string().min(1),
  source: z.object({
    roundIds: z.array(z.number().int().min(1)).min(1)
  }),
  createdAt: z.number(),
  tokenEstimateBefore: z.number().int().min(0).optional(),
  tokenEstimateAfter: z.number().int().min(0).optional()
})

export const humanConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string()
})

export const humanConversationMemorySchema = z.object({
  summary: z.string().nullable(),
  recentTurns: z.array(humanConversationTurnSchema)
})

export const humanTaskRunMemorySchema = z.object({
  rounds: z.array(humanRoundRecordSchema),
  compactions: z.array(humanCompactBlockSchema)
})

export const humanMemorySchema = z.object({
  thought: humanThoughtSchema,
  conversation: humanConversationMemorySchema,
  taskRun: humanTaskRunMemorySchema
})

export const humanSkillsSchema = z.object({
  learnedSkillIds: z
    .array(runtimeSkillIdSchema)
    .refine(
      (skillIds) =>
        skillIds.every(
          (skillId) =>
            !BUILTIN_RUNTIME_SKILL_IDS.includes(
              skillId as (typeof BUILTIN_RUNTIME_SKILL_IDS)[number]
            )
        ),
      {
        message: 'learnedSkillIds 只允许 external skill。'
      }
    )
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
