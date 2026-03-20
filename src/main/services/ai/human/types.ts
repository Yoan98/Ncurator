import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  JsonObject,
  JsonValue,
  LocalSourceUsageStatus,
  WatchdogSignalLevel
} from '../../../../shared/types'
import {
  HUMAN_STEP_ACTIONS,
  HUMAN_STEP_RESULT_STATUSES,
  RUNTIME_SKILL_IDS,
  RUNTIME_SKILL_REQUIREMENTS
} from './constants'

export type RuntimeSkillId = (typeof RUNTIME_SKILL_IDS)[number]
export type RuntimeSkillRequirement = (typeof RUNTIME_SKILL_REQUIREMENTS)[number]
export type HumanStepAction = (typeof HUMAN_STEP_ACTIONS)[number]
export type HumanStepResultStatus = (typeof HUMAN_STEP_RESULT_STATUSES)[number]

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

export type SkillCard = {
  id: RuntimeSkillId
  name: string
  summary: string
  whenToLoad: string
  workflow: string[]
  avoidWhen?: string[]
  toolNames: string[]
  requires?: RuntimeSkillRequirement[]
}

export type HumanFact = {
  id: string
  summary: string
  evidenceIds: string[]
}

export type EvidenceRef = {
  id: string
  kind: 'tool_result' | 'user_input' | 'prior_delivery'
  summary: string
  toolName?: string
  sourceRef?: string
}

export type HumanFocus = {
  current?: string
}

export type HumanMemory = {
  constraints: string[]
  facts: HumanFact[]
  evidence: EvidenceRef[]
  openQuestions: string[]
  focus: HumanFocus
  capabilityFocus: {
    activeStack: RuntimeSkillId[]
  }
}

export type HumanMemoryPatch = {
  constraints?: string[]
  facts?: HumanFact[]
  evidence?: EvidenceRef[]
  openQuestions?: string[]
  focus?: {
    current?: string | null
  }
  capabilityFocus?: {
    activeStack?: RuntimeSkillId[]
  }
}

export type HumanActivateCapabilityAction = {
  type: 'activate_capability'
  skillId: RuntimeSkillId
  rationale: string
  publicNarrative: string
}

export type HumanInvokeToolAction = {
  type: 'invoke_tool'
  toolName: string
  args: JsonObject
  rationale: string
  publicNarrative: string
}

export type HumanActionSpec = HumanActivateCapabilityAction | HumanInvokeToolAction

export type HumanActionBatch = {
  summary: string
  actions: HumanActionSpec[]
}

export type HumanCapabilityActivatedObservation = {
  id: string
  kind: 'capability_activated'
  skillId: RuntimeSkillId
  summary: string
}

export type HumanToolResultObservation = {
  id: string
  kind: 'tool_result'
  toolName: string
  ok: boolean
  code: AiTaskResultCode
  summary: string
  data?: JsonValue
}

export type HumanObservation = HumanCapabilityActivatedObservation | HumanToolResultObservation

export type ObservationBatch = {
  summary: string
  observations: HumanObservation[]
}

export type ReasonAnalysis = {
  summary: string
}

export type WatchdogHint = {
  level: WatchdogSignalLevel
  summary: string
  signs: string[]
  shouldConverge: boolean
}

export type HumanOutcome = {
  status: 'completed' | 'blocked'
  summary: string
  payload?: JsonObject
  presentation?: {
    markdown: string
  }
  provenance?: {
    localSourceStatus?: LocalSourceUsageStatus
    localSourceSummary?: string
  }
}

export type HumanReasoningOutput = {
  memoryPatch: HumanMemoryPatch
  analysis: ReasonAnalysis
  actionBatch?: HumanActionBatch
  outcome?: HumanOutcome
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

export type HumanStepRecord = HumanTraceStep

export type HumanTaskInput = {
  taskId: string
  objective: string
}

export type HumanTaskOutput = {
  taskId: string
  status: 'completed' | 'blocked'
  summary: string
  deliveryMarkdown: string
  resultCode: AiTaskResultCode
  resultData?: JsonObject
  localSourceStatus?: LocalSourceUsageStatus
  localSourceSummary?: string
}

export type HumanState = {
  task: HumanTaskInput
  progress: {
    phase: 'reasoning' | 'executing' | 'finalizing'
    maxParallel: number
  }
  memory: HumanMemory
  turn: {
    incoming?: ObservationBatch
    analysis?: ReasonAnalysis
    actionBatch?: HumanActionBatch
    watchdogHint?: WatchdogHint
  }
  outcome?: HumanOutcome
  trace: {
    steps: HumanTraceStep[]
  }
}

export type HumanRuntimeCache = {
  toolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
}

export type ToolExecutionMeta = {
  mutability: 'read_only' | 'mutating'
  parallelSafe: boolean
  resourceKey?: string
}

export type ExecuteActionResult = {
  observation: HumanObservation
  resultCode: AiTaskResultCode
}
