import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import type { WorkspaceCapabilityBuildInput } from '../types'

export type TerminalCommandInput = {
  command: string
  cwd: string
  timeoutMs: number
  captureHardLimitChars: number
}

export type TerminalCommandResult = {
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  durationMs: number
}

export type TerminalCommandSegment = {
  text: string
  tokens: string[]
}

export type TerminalArtifactCandidate = {
  rawPath: string
  operation?: AiFileArtifactOperation
}

export type TerminalCapabilityToolsInput = WorkspaceCapabilityBuildInput<TerminalToolContext> & {
  timeoutMs: number
  captureHardLimitChars: number
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

export type ResolvedCwd =
  | {
      ok: true
      cwd: string
    }
  | {
      ok: false
      code: 'workspace_required' | 'invalid_input'
      error: string
    }
