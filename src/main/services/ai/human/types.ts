import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject, JsonValue } from '../../../../shared/types'
import type { AiToolFamilyId } from './tools/types'
import {
  HUMAN_DELIVERY_MODES,
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  TOOL_CALL_RESULT_CODES
} from './constants'

export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number]
export type HumanStepAction = (typeof HUMAN_STEP_ACTIONS)[number]
export type HumanStepResultStatus = (typeof HUMAN_STEP_RESULT_STATUSES)[number]
export type ToolCallResultCode = (typeof TOOL_CALL_RESULT_CODES)[number]
export type HumanDeliveryMode = (typeof HUMAN_DELIVERY_MODES)[number]

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

export type SkillCatalogItem = {
  skillId: RuntimeSkillId
  familyId: AiToolFamilyId
  title: string
  summary: string
  toolNames: string[]
  whenToUse: string
}

export type SkillDefinition = SkillCatalogItem & {
  detail: string
}

export type BrainEvidence = {
  id: string
  toolName: string
  summary: string
  sourceType: 'tool_result'
  rawRef?: string
}

export type BrainFact = {
  id: string
  summary: string
  evidenceIds: string[]
}

export type BrainDecision = {
  summary: string
  reason: string
  expectedOutcome: string
}

export type ToolCallParam = {
  toolName: string
  args: JsonObject
}

export type ToolCallResult = {
  toolName: string
  ok: boolean
  code: ToolCallResultCode
  summary: string
  data?: JsonValue
}

export type BrainMemoryOp =
  | {
      op: 'add'
      field: 'facts'
      value: BrainFact
    }
  | {
      op: 'edit'
      field: 'facts'
      index: number
      value: BrainFact
    }
  | {
      op: 'add'
      field: 'evidences'
      value: BrainEvidence
    }
  | {
      op: 'edit'
      field: 'evidences'
      index: number
      value: BrainEvidence
    }
  | {
      op: 'add'
      field: 'openQuestions'
      value: string
    }
  | {
      op: 'edit'
      field: 'openQuestions'
      index: number
      value: string
    }
  | {
      op: 'remove'
      field: 'facts' | 'evidences' | 'openQuestions'
      index: number
    }

export type BrainNextAction =
  | {
      action: 'learning'
      wantLearnSkillIds: RuntimeSkillId[]
    }
  | {
      action: 'hand'
      parallelCallToolParam: ToolCallParam[]
    }
  | {
      action: 'mouth'
      status: 'completed' | 'blocked'
    }

export type LastBrainDecision = {
  memoryOps: BrainMemoryOp[]
  decision: BrainDecision
  nextAction: BrainNextAction
}

export type BrainDecisionRecord = LastBrainDecision & {
  createdAt: number
}

export type HumanResult = {
  status: 'completed' | 'blocked'
  summary: string
  deliveryMarkdown?: string
}

export type MouthOutput = {
  summary: string
  deliveryMarkdown?: string
}

export type HumanTraceStep = {
  step: number
  action: HumanStepAction
  publicNarrative: string
  resultStatus?: HumanStepResultStatus
  skillId?: RuntimeSkillId
  toolName?: string
  summary: string
}

export type HumanTaskInput = {
  taskId: string
  userInput: string
}

export type HumanTaskOutput = {
  taskId: string
  status: 'completed' | 'blocked'
  summary: string
  deliveryMarkdown?: string
}

export type HumanState = {
  task: HumanTaskInput
  runtime: {
    stage: 'brain' | 'learning' | 'hand' | 'mouth'
    status: 'running' | 'completed' | 'blocked'
  }
  brainMemory: {
    inside: {
      facts: BrainFact[]
      evidences: BrainEvidence[]
      openQuestions: string[]
    }
    outside: {
      skillCatalog: SkillCatalogItem[]
      learnedSkillIds: RuntimeSkillId[]
      brainDecisions: BrainDecisionRecord[]
    }
  }
  lastParallelCallToolResults?: ToolCallResult[]
  lastBrainDecision?: LastBrainDecision
  watchHint?: string
  result?: HumanResult
  trace: {
    steps: HumanTraceStep[]
  }
}

export type HumanRuntimeCache = {
  familyToolsets: Partial<Record<AiToolFamilyId, StructuredToolInterface[]>>
  skillToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
  toolCallCount: number
}
