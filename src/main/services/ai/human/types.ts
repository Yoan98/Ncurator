import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../shared/types'
import type { z } from 'zod/v4'
import type { AiToolFamilyId } from './tools/types'
import {
  HUMAN_ROUND_EXECUTION_KINDS,
  HUMAN_SKILL_AVAILABILITIES,
  HUMAN_SKILL_SOURCES,
  HUMAN_STATUSES,
  HUMAN_STAGES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  TOOL_CALL_RESULT_CODES
} from './constants'
import {
  brainDecisionSchema,
  brainNextActionSchema,
  humanDecisionSchema,
  humanExecutionSchema,
  humanHistoryToolResultSchema,
  humanLearningOutcomeSchema,
  humanLoadedHistoryContextSchema,
  humanMemoryHistorySchema,
  humanResultSchema,
  humanRoundExecutionSchema,
  humanRoundRecordSchema,
  humanStableMemoryPatchSchema,
  humanStableMemorySchema,
  humanStateContractSchema,
  humanTaskInputSchema,
  humanTaskOutputSchema,
  humanTraceStepSchema,
  humanWatchHintSchema,
  skillDefinitionBaseSchema,
  toolCallDiagnosticSchema,
  toolCallParamSchema,
  toolCallResultSchema,
  toolUsePlanSchema
} from './schema'

export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number]
export type HumanStage = (typeof HUMAN_STAGES)[number]
export type HumanStatus = (typeof HUMAN_STATUSES)[number]
export type HumanStepAction = (typeof HUMAN_STEP_ACTIONS)[number]
export type HumanStepResultStatus = (typeof HUMAN_STEP_RESULT_STATUSES)[number]
export type ToolCallResultCode = (typeof TOOL_CALL_RESULT_CODES)[number]
export type HumanSkillSource = (typeof HUMAN_SKILL_SOURCES)[number]
export type HumanSkillAvailability = (typeof HUMAN_SKILL_AVAILABILITIES)[number]
export type HumanRoundExecutionKind = (typeof HUMAN_ROUND_EXECUTION_KINDS)[number]

export type ToolPromptArgSpec = {
  name: string
  type: string
  required: boolean
  description: string
  enumValues?: readonly string[]
  defaultValue?: string
}

export type ToolPromptReturnSpec = {
  name: string
  type: string
  description: string
}

export type ToolPromptExample = {
  goal: string
  args: JsonObject
}

export type ToolPromptSpec = {
  name: string
  purpose: string
  whenToUse: string
  preconditions?: string[]
  args: ToolPromptArgSpec[]
  returns: ToolPromptReturnSpec[]
  commonMistakes?: string[]
  examples?: ToolPromptExample[]
}

export type SkillDefinitionBase = z.infer<typeof skillDefinitionBaseSchema>

export type SkillDefinition = SkillDefinitionBase & {
  detail: string
}

export type BrainDecision = z.infer<typeof brainDecisionSchema>
export type BrainNextAction = z.infer<typeof brainNextActionSchema>
export type HumanStableMemory = z.infer<typeof humanStableMemorySchema>
export type HumanStableMemoryPatch = z.infer<typeof humanStableMemoryPatchSchema>
export type HumanDecision = z.infer<typeof humanDecisionSchema>

export type ToolCallParam = z.infer<typeof toolCallParamSchema>
export type ToolUsePlan = z.infer<typeof toolUsePlanSchema>
export type ToolCallDiagnostic = z.infer<typeof toolCallDiagnosticSchema>
export type ToolCallResult = z.infer<typeof toolCallResultSchema>
export type HumanLearningOutcome = z.infer<typeof humanLearningOutcomeSchema>
export type HumanWatchHint = z.infer<typeof humanWatchHintSchema>
export type HumanHistoryToolResult = z.infer<typeof humanHistoryToolResultSchema>
export type HumanResult = z.infer<typeof humanResultSchema>
export type HumanTraceStep = z.infer<typeof humanTraceStepSchema>
export type HumanTaskInput = z.infer<typeof humanTaskInputSchema>
export type HumanTaskOutput = z.infer<typeof humanTaskOutputSchema>
export type HumanExecution = z.infer<typeof humanExecutionSchema>
export type HumanState = z.infer<typeof humanStateContractSchema>
export type HumanRoundExecution = z.infer<typeof humanRoundExecutionSchema>
export type HumanRoundRecord = z.infer<typeof humanRoundRecordSchema>
export type HumanLoadedHistoryContext = z.infer<typeof humanLoadedHistoryContextSchema>
export type HumanMemoryHistory = z.infer<typeof humanMemoryHistorySchema>

export type HumanRuntimeCache = {
  familyToolsets: Partial<Record<AiToolFamilyId, StructuredToolInterface[]>>
  skillToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
  toolCallCount: number
  currentState?: HumanState
}
