import { z } from 'zod/v4'
import { aiArtifactRefSchema } from '../schema'
import { jsonObjectSchema, jsonValueSchema, toolResourceContextSchema } from './toolSchemas'
import {
  AI_TOOL_FAMILY_IDS,
  BUILTIN_RUNTIME_SKILL_IDS,
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_SKILL_SOURCES,
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS
} from './constants'

export const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
export const toolFamilyIdSchema = z.enum(AI_TOOL_FAMILY_IDS)
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
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
  toolNames: z.array(z.string().min(1))
})

export const toolCallParamSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

const failedToolCallDataSchema = z
  .object({
    error: z.string().min(1)
  })
  .catchall(jsonValueSchema)

export const toolCallResultSchema = z.discriminatedUnion('ok', [
  z.object({
    toolName: z.string().min(1),
    ok: z.literal(true),
    data: jsonValueSchema.optional(),
    resourceContext: toolResourceContextSchema.optional()
  }),
  z.object({
    toolName: z.string().min(1),
    ok: z.literal(false),
    data: failedToolCallDataSchema,
    resourceContext: toolResourceContextSchema.optional()
  })
])

export const handCallsSchema = z.array(toolCallParamSchema)

export const humanLearningOutcomeSchema = z.object({
  requestedSkillIds: z.array(z.string().min(1)),
  loadedSkillIds: z.array(runtimeSkillIdSchema),
  skippedDuplicateSkillIds: z.array(runtimeSkillIdSchema),
  skippedUnknownSkillIds: z.array(z.string().min(1)),
  evictedSkillIds: z.array(runtimeSkillIdSchema),
  activeToolCount: z.number().int().min(0)
})

export const humanHistoryToolResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  data: jsonValueSchema.optional(),
  artifactRefs: z.array(aiArtifactRefSchema).optional(),
  resourceContext: toolResourceContextSchema.optional()
})

export const humanPlanItemStatusSchema = z.enum(['todo', 'in_progress', 'done'])

export const humanPlanItemSchema = z.object({
  title: z.string().min(1),
  status: humanPlanItemStatusSchema
})

export const humanRoundThoughtSchema = z.object({
  text: z.string()
})

export const brainEvidenceReferenceSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  resourceType: z.enum(['file', 'web']),
  usedFor: z.string().min(1)
})

export const humanReferenceSchema = brainEvidenceReferenceSchema.extend({
  accessStatus: z.enum(['accessible', 'unavailable'])
})

export const humanNextActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('learning'),
    wantLearnSkillIds: z.array(z.string().min(1)).min(1),
    toolCallId: z.string().min(1)
  }),
  z.object({
    action: z.literal('hand'),
    calls: handCallsSchema
  }),
  z.object({
    action: z.literal('plan'),
    calls: handCallsSchema
  })
])

export const humanDeliveryPayloadSchema = z.object({
  deliveryMarkdown: z.string().default('')
})

export const fileChangeSummaryItemSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  path: z.string().min(1),
  capability: z.enum(['docx', 'text_file', 'terminal_exec', 'ppt', 'excel', 'image']),
  operation: z.enum(['created', 'updated', 'deleted', 'renamed']),
  changeCount: z.number().int().min(0),
  insertCount: z.number().int().min(0),
  deleteCount: z.number().int().min(0),
  status: z.enum(['applied', 'reverted', 'failed'])
})

export const fileChangesSummarySchema = z.object({
  changed_files: z.array(fileChangeSummaryItemSchema)
})

export const deliveryGuidanceItemSchema = z.object({
  source: z.enum(['brain', 'hand']),
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

export const humanDispatchItemSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: jsonObjectSchema,
  target: z.enum(['learning', 'plan', 'hand'])
})

export const humanExecutionSchema = z.object({
  stage: humanStageSchema,
  status: humanStatusSchema,
  finalizationReason: z.enum(['brain_content_safety']).optional(),
  pendingRound: z
    .object({
      thought: humanRoundThoughtSchema,
      nextAction: humanNextActionSchema
    })
    .optional(),
  pendingDispatch: z.array(humanDispatchItemSchema).optional(),
  deliveryGuidanceItems: z.array(deliveryGuidanceItemSchema).optional(),
  lastToolResults: z.array(toolCallResultSchema).optional(),
  lastLearningOutcome: humanLearningOutcomeSchema.optional(),
  artifacts: z.array(aiArtifactRefSchema),
  fileChanges: fileChangesSummarySchema.optional(),
  evidenceReferences: z.array(humanReferenceSchema).optional(),
  contextBudget: z
    .object({
      evaluationId: z.string().min(1),
      basis: z.enum(['initial', 'usage_plus_delta', 'post_compaction', 'usage_unavailable']),
      budgetTokens: z.number().int().min(0),
      contextWindowTokens: z.number().int().min(1),
      compactionTriggerTokens: z.number().int().min(1),
      hasCompressibleHistory: z.boolean(),
      usageAvailable: z.boolean(),
      lastBrainInputTokens: z.number().int().min(0).optional(),
      deltaTokenEstimate: z.number().int().min(0).optional()
    })
    .optional()
})

export const humanCompactionBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('compacted_history'),
  summary: z.string().min(1),
  createdAt: z.number(),
  tokenEstimateBefore: z.number().int().min(0).optional(),
  sourceHistoryTokenEstimate: z.number().int().min(0).optional(),
  tokenEstimateAfter: z.number().int().min(0).optional()
})

export const humanMemorySchema = z.object({
  plan: z.array(humanPlanItemSchema),
  compactions: z.array(humanCompactionBlockSchema)
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
