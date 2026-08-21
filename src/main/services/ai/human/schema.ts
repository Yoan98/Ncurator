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
  HUMAN_DECISION_HINT_CODES,
  RUNTIME_SKILL_IDS
} from './constants'

export const runtimeSkillIdSchema = z.enum(RUNTIME_SKILL_IDS)
export const toolFamilyIdSchema = z.enum(AI_TOOL_FAMILY_IDS)
export const humanStageSchema = z.enum(HUMAN_STAGES)
export const humanStatusSchema = z.enum(HUMAN_STATUSES)
export const humanDecisionHintCodeSchema = z.enum(HUMAN_DECISION_HINT_CODES)
export const humanSkillSourceSchema = z.enum(HUMAN_SKILL_SOURCES)
export const humanRoundExecutionKindSchema = z.enum(HUMAN_ROUND_EXECUTION_KINDS)

export const humanTaskInterruptionReasonSchema = z.enum([
  'timeout',
  'network_error',
  'user_cancelled',
  'process_interrupted',
  'runtime_limit',
  'unexpected_error'
])

export const humanTaskContextSchema = z.object({
  originalGoal: z.string(),
  recoveryHistory: z.array(
    z.object({
      interruptionReason: humanTaskInterruptionReasonSchema,
      userInput: z.string()
    })
  ),
  currentInterruption: z
    .object({
      reason: humanTaskInterruptionReasonSchema
    })
    .optional()
})

export const humanTaskInputSchema = z.object({
  taskId: z.string(),
  userInput: z.string(),
  taskContext: humanTaskContextSchema.optional()
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

export const humanDecisionHintSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('run_resumed_after_interruption'),
    detail: z.object({
      reason: humanTaskInterruptionReasonSchema
    })
  }),
  z.object({
    code: z.literal('learning_no_effect'),
    detail: z.object({
      requestedSkillIds: z.array(z.string().min(1)),
      duplicateSkillIds: z.array(runtimeSkillIdSchema),
      unknownSkillIds: z.array(z.string().min(1))
    })
  }),
  z.object({
    code: z.literal('terminal_approval_blocked'),
    detail: z.object({
      allowedCommands: z.array(z.string().min(1)),
      blockedCommands: z.array(z.string().min(1)),
      notes: z.array(
        z.object({
          command: z.string().min(1),
          message: z.string().min(1)
        })
      )
    })
  }),
  z.object({
    code: z.literal('hand_call_limit_exceeded'),
    detail: z.object({
      offendingToolNames: z.array(z.string().min(1)),
      callCount: z.number().int().min(1),
      limit: z.number().int().min(1)
    })
  }),
  z.object({
    code: z.literal('legacy_doc_edit_unsupported'),
    detail: z.object({
      instruction: z.string().min(1)
    })
  }),
  z.object({
    code: z.literal('hand_docx_edit_failed'),
    detail: z.object({
      toolName: z.literal('docx_edit'),
      sourcePath: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      error: z.string().min(1)
    })
  }),
  z.object({
    code: z.literal('hand_docx_positioned_write_blocked'),
    detail: z.object({
      toolName: z.literal('docx_edit'),
      sourcePath: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      error: z.string().min(1)
    })
  }),
  z.object({
    code: z.literal('hand_tool_limit_near_exhausted'),
    detail: z.object({
      toolCallCount: z.number().int().min(0),
      limit: z.number().int().min(1)
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
    code: z.literal('hand_tool_result_too_large'),
    detail: z.object({
      toolName: z.string().min(1),
      estimatedTokens: z.number().int().min(1),
      limit: z.number().int().min(1)
    })
  }),
  z.object({
    code: z.literal('hand_tool_result_unusable'),
    detail: z.object({
      toolName: z.string().min(1),
      totalChars: z.number().int().min(0),
      nulCount: z.number().int().min(0),
      replacementCharCount: z.number().int().min(0),
      replacementCharRatio: z.number().min(0).max(1),
      controlCharCount: z.number().int().min(0),
      controlCharRatio: z.number().min(0).max(1),
      matchedSignatures: z.array(z.string().min(1))
    })
  }),
  z.object({
    code: z.literal('brain_output_schema_invalid'),
    detail: z.object({
      issues: z
        .array(
          z.object({
            path: z.string().min(1),
            message: z.string().min(1)
          })
        )
        .min(1)
        .max(3)
    })
  }),
  z.object({
    code: z.literal('brain_todolist_incomplete'),
    detail: z.object({
      pendingItems: z.array(z.string().min(1)).min(1)
    })
  }),
  z.object({
    code: z.literal('brain_content_safety'),
    detail: z.object({ message: z.string().min(1) })
  }),
  z.object({
    code: z.literal('hand_call_invalid'),
    detail: z.object({
      invalidCalls: z
        .array(
          z.object({
            callIndex: z.number().int().min(0),
            toolName: z.string().min(1),
            message: z.string().min(1)
          })
        )
        .min(1)
    })
  })
])

export const humanHistoryToolResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  data: jsonValueSchema.optional(),
  artifactRefs: z.array(aiArtifactRefSchema).optional(),
  resourceContext: toolResourceContextSchema.optional()
})

export const humanTodoItemStatusSchema = z.enum(['todo', 'done'])

export const humanTodoItemSchema = z.object({
  item: z.string().min(1),
  status: humanTodoItemStatusSchema
})

export const humanThoughtSchema = z.object({
  next: z.string().min(1),
  todolist: z.array(humanTodoItemSchema).optional(),
  progressOverview: z.string().optional()
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

export const learningNextActionSchema = z.object({
  action: z.literal('learning'),
  wantLearnSkillIds: z.array(z.string().min(1)).min(1)
})

export const handNextActionSchema = z.object({
  action: z.literal('hand'),
  calls: handCallsSchema
})

export const mouthNextActionSchema = z.object({
  action: z.literal('mouth'),
  evidenceReferences: z.array(brainEvidenceReferenceSchema).optional()
})

export const brainNextActionSchema = z
  .object({
    action: z.string().min(1)
  })
  .catchall(jsonValueSchema)

export const brainPromptNextActionSchema = z.discriminatedUnion('action', [
  learningNextActionSchema,
  handNextActionSchema,
  mouthNextActionSchema
])

export const humanThoughtDecisionPromptSchema = z.object({
  thought: humanThoughtSchema,
  nextAction: brainPromptNextActionSchema
})

export const createBrainNextActionSchema = () => brainNextActionSchema

export const createHumanThoughtDecisionSchema = () => humanThoughtDecisionSchema

export const humanThoughtDecisionSchema = z.object({
  thought: humanThoughtSchema,
  nextAction: brainNextActionSchema
})

export const humanDeliveryPayloadSchema = z.object({
  deliveryMarkdown: z.string().default('')
})

export const mouthOutputSchema = humanDeliveryPayloadSchema

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

export const humanExecutionSchema = z.object({
  stage: humanStageSchema,
  status: humanStatusSchema,
  finalizationReason: z.enum(['brain_content_safety']).optional(),
  currentThought: humanThoughtDecisionSchema.optional(),
  pendingFault: z
    .object({
      result: z.string().min(1),
      issues: z.array(z.object({ path: z.string().min(1), message: z.string().min(1) })).optional()
    })
    .optional(),
  pendingDecisionHint: humanDecisionHintSchema.optional(),
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

export const humanRoundExecutionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('learning'),
    learningOutcome: humanLearningOutcomeSchema,
    result: z.string().min(1),
    decisionHint: humanDecisionHintSchema.optional()
  }),
  z.object({
    kind: z.literal('hand'),
    calls: handCallsSchema,
    toolResults: z.array(humanHistoryToolResultSchema),
    decisionHint: humanDecisionHintSchema.optional(),
    artifactRefs: z.array(aiArtifactRefSchema).optional()
  }),
  z.object({
    kind: z.literal('mouth'),
    result: z.string().min(1),
    decisionHint: humanDecisionHintSchema.optional()
  }),
  z.object({
    kind: z.literal('fault'),
    result: z.string().min(1),
    decisionHint: humanDecisionHintSchema.optional()
  })
])

export const humanRoundRecordSchema = z.object({
  roundId: z.number().int().min(1),
  createdAt: z.number(),
  thought: humanThoughtSchema,
  nextAction: brainNextActionSchema,
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
  sourceHistoryTokenEstimate: z.number().int().min(0).optional(),
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
  todolist: z.array(humanTodoItemSchema),
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
