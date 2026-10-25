import { z } from 'zod/v4'
import { aiArtifactRefSchema } from '../schema'
import { jsonObjectSchema, jsonValueSchema, toolResourceContextSchema } from './toolSchemas'
import {
  AI_TOOL_FAMILY_IDS,
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_TOOLSET_SOURCES,
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_TOOLSET_IDS
} from './constants'
import { BUILTIN_RUNTIME_TOOLSET_IDS } from './toolsets'

export const runtimeToolsetIdSchema = z.enum(RUNTIME_TOOLSET_IDS)
export const toolFamilyIdSchema = z.enum(AI_TOOL_FAMILY_IDS)
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
export const humanToolsetSourceSchema = z.enum(HUMAN_TOOLSET_SOURCES)
export const humanRoundExecutionKindSchema = z.enum(HUMAN_ROUND_EXECUTION_KINDS)

export const humanTaskInputSchema = z.object({
  taskId: z.string(),
  userInput: z.string()
})

export const toolsetDefinitionBaseSchema = z.object({
  toolsetId: runtimeToolsetIdSchema,
  familyId: toolFamilyIdSchema,
  source: humanToolsetSourceSchema,
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
    imageRefs: z
      .array(
        z.object({
          path: z.string().min(1),
          mimeType: z.string().min(1),
          sizeBytes: z.number().int().positive(),
          width: z.number().int().positive(),
          height: z.number().int().positive()
        })
      )
      .optional(),
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

export const humanSkillLoadingOutcomeSchema = z.object({
  requestedSkillNames: z.array(z.string().min(1)),
  loadedSkillNames: z.array(z.string().min(1)),
  skippedDuplicateSkillNames: z.array(z.string().min(1)),
  unavailableSkills: z.array(z.object({ name: z.string(), error: z.string() }))
})

export const humanToolsetLoadingOutcomeSchema = z.object({
  requestedToolsetNames: z.array(z.string().min(1)),
  loadedToolsetIds: z.array(runtimeToolsetIdSchema),
  skippedDuplicateToolsetIds: z.array(runtimeToolsetIdSchema),
  skippedUnknownToolsetNames: z.array(z.string().min(1)),
  evictedToolsetIds: z.array(runtimeToolsetIdSchema),
  activeToolCount: z.number().int().min(0)
})

export const humanPlanItemStatusSchema = z.enum(['todo', 'done'])

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
    action: z.literal('interaction'),
    toolCallId: z.string().min(1),
    toolName: z.literal('ask_user_question'),
    args: jsonObjectSchema
  }),
  z.object({
    action: z.literal('skill_loading'),
    wantLoadSkillNames: z.array(z.string().min(1)).min(1),
    toolCallId: z.string().min(1)
  }),
  z.object({
    action: z.literal('toolset_loading'),
    wantLoadToolsetNames: z.array(z.string().min(1)).min(1),
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
  capability: z.enum(['docx', 'text_file', 'ppt', 'excel', 'image']),
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
  status: z.enum(['completed', 'yielded']),
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const humanDispatchItemSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: jsonObjectSchema,
  target: z.enum(['skill_loading', 'toolset_loading', 'plan', 'hand', 'interaction'])
})

export const humanExecutionSchema = z.object({
  stage: humanStageSchema,
  status: humanStatusSchema,
  pendingRound: z
    .object({
      thought: humanRoundThoughtSchema,
      nextAction: humanNextActionSchema
    })
    .optional(),
  pendingDispatch: z.array(humanDispatchItemSchema).optional(),
  deliveryGuidanceItems: z.array(deliveryGuidanceItemSchema).optional(),
  lastToolResults: z.array(toolCallResultSchema).optional(),
  lastToolsetLoadingOutcome: humanToolsetLoadingOutcomeSchema.optional(),
  lastSkillLoadingOutcome: humanSkillLoadingOutcomeSchema.optional(),
  artifacts: z.array(aiArtifactRefSchema),
  fileChanges: fileChangesSummarySchema.optional(),
  evidenceReferences: z.array(humanReferenceSchema).optional(),
  contextBudget: z
    .object({
      evaluationId: z.string().min(1),
      basis: z.enum(['initial', 'usage_plus_delta', 'post_compaction', 'usage_unavailable']),
      budgetTokens: z.number().int().min(0),
      contextWindowTokens: z.number().int().min(1),
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
  loadedSkillNames: z.array(
    z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(64)
  )
})

export const humanToolsetsSchema = z.object({
  loadedToolsetIds: z
    .array(runtimeToolsetIdSchema)
    .refine(
      (toolsetIds) =>
        toolsetIds.every(
          (toolsetId) =>
            !BUILTIN_RUNTIME_TOOLSET_IDS.includes(
              toolsetId as (typeof BUILTIN_RUNTIME_TOOLSET_IDS)[number]
            )
        ),
      {
        message: 'loadedToolsetIds 只允许 external toolset。'
      }
    )
})

export const humanTraceStepSchema = z.object({
  step: z.number(),
  action: z.enum(HUMAN_STEP_ACTIONS),
  publicNarrative: z.string(),
  resultStatus: z.enum(HUMAN_STEP_RESULT_STATUSES).optional(),
  toolsetId: runtimeToolsetIdSchema.optional(),
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
  toolsets: humanToolsetsSchema,
  skills: humanSkillsSchema,
  result: humanResultSchema.optional(),
  trace: humanTraceSchema
})
