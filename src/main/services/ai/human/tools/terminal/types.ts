import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import type { WorkspaceCapabilityBuildInput } from '../types'
import type { TerminalSessionManager } from './TerminalSessionManager'

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
  aiResultTokenLimitRatio: number
}

export type TerminalCapabilityToolsRuntimeState = {
  stepIndex: number
}

export type TerminalCommandAnalysis = {
  resourceKey: string
  artifactCandidates: TerminalArtifactCandidate[]
}

export type TerminalSafeExecutionPolicy = 'safe_allowed' | 'approval_required'

export type TerminalSafePolicyResult = {
  executionPolicy: TerminalSafeExecutionPolicy
  effect: 'read_only' | 'mutating' | 'unknown'
  matchedRuleId?: string
  reasonCode: string
  reason: string
}
