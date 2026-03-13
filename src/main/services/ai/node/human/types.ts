import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  HumanStepDecision,
  HumanStepRecord,
  HumanTaskInput,
  JsonValue,
  LocalSourceUsageStatus,
  RuntimeSkillId,
  SkillCard
} from '../../../../../shared/types'
import type { HumanDeliveryKind } from '../../types'

export type HumanPhase = 'brain' | 'skill_loader' | 'tool_exec' | 'response'

export type LoadedSkill = {
  skillId: RuntimeSkillId
  skillContent: string
  referencedAssets: string[]
  toolNames: string[]
  loadedAtStep: number
}

export type HumanSkillLoadObservation = {
  kind: 'skill_loaded'
  skillId: RuntimeSkillId
  summary: string
  activeSkillIds: RuntimeSkillId[]
  activeToolNames: string[]
}

export type HumanToolObservation = {
  kind: 'tool_result'
  toolName: string
  ok: boolean
  code: AiTaskResultCode
  summary: string
  data?: JsonValue
}

export type HumanTerminalObservation = {
  kind: 'terminal'
  status: 'completed' | 'blocked'
  code: AiTaskResultCode
  summary: string
  data?: JsonValue
}

export type HumanObservation =
  | HumanSkillLoadObservation
  | HumanToolObservation
  | HumanTerminalObservation

export type HumanRunState = {
  runId: string
  input: HumanTaskInput
  phase: HumanPhase
  status: 'running' | 'completed' | 'blocked'
  deliveryKind: HumanDeliveryKind
  streamAnswer: boolean
  internalDelivery: boolean
  steps: number
  maxSteps: number
  availableSkillCards: SkillCard[]
  loadedSkills: Partial<Record<RuntimeSkillId, LoadedSkill>>
  loadedToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
  activeSkillIds: RuntimeSkillId[]
  activeTools: StructuredToolInterface[]
  lastObservation?: HumanObservation
  lastDecision?: HumanStepDecision
  stepHistory: HumanStepRecord[]
  summary: string
  deliveryMarkdown: string
  resultCode: AiTaskResultCode
  resultData?: Record<string, JsonValue>
  localSourceStatus?: LocalSourceUsageStatus
  localSourceSummary?: string
}
