import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiTaskResultCode,
  HumanStepDecision,
  HumanStepRecord,
  HumanTaskInput,
  JsonValue,
  LocalSourceUsageStatus,
  RuntimeSkillId
} from '../../../../../shared/types'
import type { HumanDeliveryKind } from '../../types'

export type HumanStatus =
  | 'brain'
  | 'skill_loader'
  | 'tool_exec'
  | 'response'
  | 'completed'
  | 'blocked'

export type HumanSkillLoadObservation = {
  kind: 'skill_loaded'
  skillId: RuntimeSkillId
  summary: string
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
  status: HumanStatus
  deliveryKind: HumanDeliveryKind
  streamAnswer: boolean
  internalDelivery: boolean
  steps: number
  maxSteps: number
  loadedSkillIds: RuntimeSkillId[]
  loadedToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
  activeSkillIds: RuntimeSkillId[]
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
