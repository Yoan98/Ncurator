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

export type ArtifactCandidate = {
  resolvedPath: string
  summary: string
  requestedOperation?: AiFileArtifactOperation
  existedBefore: boolean
}

export type PreparedArtifactCandidate = ArtifactCandidate & {
  beforeSnapshotPath?: string
  beforeChecksum?: string
}

export type TerminalCommandAnalysis = {
  resourceKey: string
  artifactCandidates: TerminalArtifactCandidate[]
}

export type TerminalSafeExecutionPolicy = 'safe_allowed' | 'approval_required'

export type TerminalSafePolicyResult = {
  executionPolicy: TerminalSafeExecutionPolicy
  matchedRuleId?: string
  reason: string
}
