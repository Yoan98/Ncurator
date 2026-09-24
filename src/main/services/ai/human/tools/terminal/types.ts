import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import type { WorkspaceCapabilityBuildInput } from '../types'
import type { TerminalSessionManager } from './TerminalSessionManager'
import type { TerminalRiskReason } from './policy/types'

export type TerminalCommandSegment = {
  text: string
  tokens: string[]
}

export type TerminalArtifactCandidate = {
  rawPath: string
  operation?: AiFileArtifactOperation
}

export type TerminalCapabilityToolsInput = WorkspaceCapabilityBuildInput<TerminalToolContext> & {
  workspaceId: string
  sessionManager: TerminalSessionManager
}

export type TerminalCapabilityToolsRuntimeState = {
  stepIndex: number
}

export type TerminalCommandAnalysis = {
  resourceKey: string
  artifactCandidates: TerminalArtifactCandidate[]
}

export type TerminalExecutionPolicy = 'auto_allow' | 'approval_required'

export type TerminalRiskPolicyResult = {
  executionPolicy: TerminalExecutionPolicy
  decision: TerminalExecutionPolicy
  matchedRuleId?: string
  reasonCode: TerminalRiskReason | 'none'
  reasons: TerminalRiskReason[]
  reason: string
}
