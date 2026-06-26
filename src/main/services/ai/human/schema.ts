import { z } from 'zod/v4'
import { aiArtifactRefSchema } from '../schema'
import {
  createHandCallsSchema
} from './toolCallSchema'
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
  HUMAN_HAND_CALL_LIMIT,
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

export const toolCallResultSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  data: jsonValueSchema.optional(),
  diagnostic: toolCallDiagnosticSchema.optional(),
  resourceContext: toolResourceContextSchema.optional()
})

export const handCallsSchema = z.array(toolCallParamSchema).min(1).max(HUMAN_HAND_CALL_LIMIT)

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
      reason: z.enum(['timeout', 'network_error'])
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
    code: z.literal('hand_docx_edit_failed'),
    detail: z.object({
      toolName: z.literal('docx_edit'),
      sourcePath: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      error: z.string().min(1),
      diagnostic: z.string().min(1).optional()
    })
  }),
  z.object({
    code: z.literal('hand_docx_positioned_write_blocked'),
    detail: z.object({
      toolName: z.literal('docx_edit'),
      sourcePath: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      diagnostic: z.string().min(1)
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
      reason: z.literal('non_text_output'),
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
  }),
  z.object({
    code: z.literal('hand_workspace_boundary_blocked'),
    detail: z.object({
      blockedCalls: z
        .array(
          z.object({
            callIndex: z.number().int().min(0),
            toolName: z.string().min(1),
            message: z.string().min(1)
          })
        )
        .min(1)
    })
  }),
  z.object({
    code: z.literal('hand_tool_runtime_failed'),
    detail: z.object({
      failedCalls: z
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
  diagnosticText: z.string().optional(),
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
  progressionSummary: z.string().optional()
})

export const humanReferenceSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  resourceType: z.enum(['file', 'web']),
  usedFor: z.string().min(1)
})

export const createBrainNextActionSchema = (toolNames: readonly string[]) =>
  z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('learning'),
        wantLearnSkillIds: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    z
      .object({
        action: z.literal('hand'),
        calls: createHandCallsSchema(toolNames)
      })
      .strict(),
    z
      .object({
        action: z.literal('mouth'),
        references: z.array(humanReferenceSchema).optional()
      })
      .strict()
  ])

export const createHumanThoughtDecisionSchema = (toolNames: readonly string[]) =>
  z.object({
    thought: humanThoughtSchema,
    nextAction: createBrainNextActionSchema(toolNames)
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
      calls: handCallsSchema
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

export const fileChangeSummaryItemSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  path: z.string().min(1),
  capability: z.enum(['docx', 'terminal_exec', 'ppt']),
  operation: z.enum(['created', 'updated']),
  changeCount: z.number().int().min(0),
  insertCount: z.number().int().min(0),
  deleteCount: z.number().int().min(0),
  status: z.enum(['applied', 'reverted', 'failed'])
})

export const fileChangesSummarySchema = z.object({
  changed_files: z.array(fileChangeSummaryItemSchema)
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
  brainSchemaRetryCount: z.number().int().min(0).optional(),
  deliveryGuidanceItems: z.array(deliveryGuidanceItemSchema).optional(),
  lastToolResults: z.array(toolCallResultSchema).optional(),
  lastLearningOutcome: humanLearningOutcomeSchema.optional(),
  artifacts: z.array(aiArtifactRefSchema),
  fileChanges: fileChangesSummarySchema.optional(),
  references: z.array(humanReferenceSchema).optional(),
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
    calls: handCallsSchema,
    toolResults: z.array(humanHistoryToolResultSchema),
    decisionHint: humanDecisionHintSchema.optional(),
    artifactRefs: z.array(aiArtifactRefSchema).optional()
  }),
  z.object({
    kind: z.literal('mouth'),
    action: z.literal('deliver_result')
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
