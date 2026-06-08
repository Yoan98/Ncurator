import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../shared/types'
import type { z } from 'zod/v4'
import type { AiToolFamilyId } from './tools/types'
import type { DocxToolRuntime } from './tools/docx/runtime'
import {
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_SKILL_SOURCES,
  HUMAN_STATUSES,
  HUMAN_STAGES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS
} from './constants'
import {
  humanThoughtSchema,
  brainNextActionSchema,
  deliveryGuidanceItemSchema,
  humanThoughtDecisionSchema,
  humanTodoItemSchema,
  humanTodoItemStatusSchema,
  humanExecutionSchema,
  humanHistoryToolResultSchema,
  humanLearningOutcomeSchema,
  humanCompactBlockSchema,
  humanConversationMemorySchema,
  humanConversationTurnSchema,
  humanTaskRunMemorySchema,
  humanResultSchema,
  humanRoundExecutionSchema,
  humanRoundRecordSchema,
  humanStateContractSchema,
  humanTaskInputSchema,
  humanTaskOutputSchema,
  humanTraceStepSchema,
  humanReferenceSchema,
  fileChangesSummarySchema,
  fileChangeSummaryItemSchema,
  humanDecisionHintSchema,
  skillDefinitionBaseSchema,
  toolCallDiagnosticSchema,
  toolCallParamSchema,
  toolCallResultSchema,
  handCallsSchema
} from './schema'
import { toolResourceContextSchema } from './toolSchemas'

export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number]
export type HumanStage = (typeof HUMAN_STAGES)[number]
export type HumanStatus = (typeof HUMAN_STATUSES)[number]
export type HumanStepAction = (typeof HUMAN_STEP_ACTIONS)[number]
export type HumanStepResultStatus = (typeof HUMAN_STEP_RESULT_STATUSES)[number]
export type HumanSkillSource = (typeof HUMAN_SKILL_SOURCES)[number]
export type HumanRoundExecutionKind = (typeof HUMAN_ROUND_EXECUTION_KINDS)[number]

export type ToolPromptExample = {
  goal: string
  args: JsonObject
}

export type ToolPromptSpec = {
  name: string
  description: string
  whenToUse: string
  examples: ToolPromptExample[]
}

export type SkillDefinitionBase = z.infer<typeof skillDefinitionBaseSchema>
export type SkillDefinition = SkillDefinitionBase

export type HumanThought = z.infer<typeof humanThoughtSchema>
export type BrainNextAction = z.infer<typeof brainNextActionSchema>
export type HumanTodoItemStatus = z.infer<typeof humanTodoItemStatusSchema>
export type HumanTodoItem = z.infer<typeof humanTodoItemSchema>
export type HumanThoughtDecision = z.infer<typeof humanThoughtDecisionSchema>
export type DeliveryGuidanceItem = z.infer<typeof deliveryGuidanceItemSchema>
export type HumanReference = z.infer<typeof humanReferenceSchema>

export type ToolCallParam = z.infer<typeof toolCallParamSchema>
export type HandCallList = z.infer<typeof handCallsSchema>
export type ToolCallDiagnostic = z.infer<typeof toolCallDiagnosticSchema>
export type ToolResourceContext = z.infer<typeof toolResourceContextSchema>
export type ToolCallResult = z.infer<typeof toolCallResultSchema>
export type HumanLearningOutcome = z.infer<typeof humanLearningOutcomeSchema>
export type HumanDecisionHint = z.infer<typeof humanDecisionHintSchema>
export type HumanHistoryToolResult = z.infer<typeof humanHistoryToolResultSchema>
export type HumanCompactionBlock = z.infer<typeof humanCompactBlockSchema>
export type HumanResult = z.infer<typeof humanResultSchema>
export type HumanTraceStep = z.infer<typeof humanTraceStepSchema>
export type HumanTaskInput = z.infer<typeof humanTaskInputSchema>
export type HumanTaskOutput = z.infer<typeof humanTaskOutputSchema>
export type HumanExecution = z.infer<typeof humanExecutionSchema>
export type HumanState = z.infer<typeof humanStateContractSchema>
export type FileChangeSummaryItem = z.infer<typeof fileChangeSummaryItemSchema>
export type FileChangesSummary = z.infer<typeof fileChangesSummarySchema>
export type HumanRoundExecution = z.infer<typeof humanRoundExecutionSchema>
export type HumanRoundRecord = z.infer<typeof humanRoundRecordSchema>
export type HumanConversationTurn = z.infer<typeof humanConversationTurnSchema>
export type HumanConversationMemory = z.infer<typeof humanConversationMemorySchema>
export type HumanTaskRunMemory = z.infer<typeof humanTaskRunMemorySchema>

export type HumanRuntimeCache = {
  familyToolsets: Partial<Record<AiToolFamilyId, StructuredToolInterface[]>>
  skillToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
  docxRuntime?: DocxToolRuntime
  approvedTerminalCommandCounts?: Map<string, number>
  toolCallCount: number
  currentState?: HumanState
  lastBrainInputTokens?: number
  lastBrainRoundCount?: number
  postCompactionNeedsFreshBrainUsage?: boolean
  lastBrainUsageUnavailable?: boolean
}
