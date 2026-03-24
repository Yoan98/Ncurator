import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { TerminalToolContext } from '../../../types'
import type { WorkspaceCapabilityBuildInput } from '../types'

export type TerminalCommandInput = {
  command: string
  cwd: string
  timeoutMs: number
  maxOutputChars: number
}

export type TerminalCommandResult = {
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  truncated: boolean
  durationMs: number
}

export type TerminalArtifactCandidate = {
  rawPath: string
  operation?: AiFileArtifactOperation
}

export type TerminalCapabilityToolsInput = WorkspaceCapabilityBuildInput<TerminalToolContext> & {
  timeoutMs: number
  maxOutputChars: number
  safePreviewChars: number
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
