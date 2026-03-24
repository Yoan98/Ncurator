import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../shared/types'
import type { z } from 'zod/v4'
import type { AiToolFamilyId } from './tools/types'
import {
  HUMAN_STAGES,
  HUMAN_STATUSES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  TOOL_CALL_RESULT_CODES
} from './constants'
import {
  brainDecisionRecordSchema,
  brainDecisionSchema,
  brainEvidenceSchema,
  brainFactSchema,
  brainMemoryOpSchema,
  brainNextActionSchema,
  humanDeliveryModeSchema,
  humanResultSchema,
  humanStateContractSchema,
  humanTaskInputSchema,
  humanTaskOutputSchema,
  humanTraceStepSchema,
  lastBrainDecisionSchema,
  mouthOutputSchema,
  skillCatalogItemSchema,
  toolCallParamSchema,
  toolCallResultSchema
} from './schema'

export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number]
export type HumanStage = (typeof HUMAN_STAGES)[number]
export type HumanStatus = (typeof HUMAN_STATUSES)[number]
export type HumanStepAction = (typeof HUMAN_STEP_ACTIONS)[number]
export type HumanStepResultStatus = (typeof HUMAN_STEP_RESULT_STATUSES)[number]
export type ToolCallResultCode = (typeof TOOL_CALL_RESULT_CODES)[number]
export type HumanDeliveryMode = z.infer<typeof humanDeliveryModeSchema>

export type ToolPromptArgSpec = {
  name: string
  type: string
  required: boolean
  description: string
  enumValues?: string[]
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

export type SkillCatalogItem = z.infer<typeof skillCatalogItemSchema>

export type SkillDefinition = SkillCatalogItem & {
  detail: string
}

export type BrainEvidence = z.infer<typeof brainEvidenceSchema>

export type BrainFact = z.infer<typeof brainFactSchema>

export type BrainDecision = z.infer<typeof brainDecisionSchema>

export type ToolCallParam = z.infer<typeof toolCallParamSchema>

export type ToolCallResult = z.infer<typeof toolCallResultSchema>

export type BrainMemoryOp = z.infer<typeof brainMemoryOpSchema>

export type BrainNextAction = z.infer<typeof brainNextActionSchema>

export type LastBrainDecision = z.infer<typeof lastBrainDecisionSchema>

export type BrainDecisionRecord = z.infer<typeof brainDecisionRecordSchema>

export type HumanResult = z.infer<typeof humanResultSchema>

export type MouthOutput = z.infer<typeof mouthOutputSchema>

export type HumanTraceStep = z.infer<typeof humanTraceStepSchema>

export type HumanTaskInput = z.infer<typeof humanTaskInputSchema>

export type HumanTaskOutput = z.infer<typeof humanTaskOutputSchema>

export type HumanState = z.infer<typeof humanStateContractSchema>

export type HumanRuntimeCache = {
  familyToolsets: Partial<Record<AiToolFamilyId, StructuredToolInterface[]>>
  skillToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
  toolCallCount: number
}
