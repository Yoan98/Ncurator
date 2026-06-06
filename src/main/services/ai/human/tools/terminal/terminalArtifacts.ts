import fs from 'node:fs'
import path from 'node:path'
import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { ArtifactCandidate, TerminalArtifactCandidate } from './types'
import { resolveWorkspacePath } from './commandPolicy'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { TerminalToolContext } from '../../../types'
import type { CapabilityActivityInput } from '../types'

export const mergeArtifactCandidates = (input: {
  commandCandidates: TerminalArtifactCandidate[]
  expectedArtifacts: Array<{ path: string; operation?: AiFileArtifactOperation; summary?: string }>
  cwd: string
  workspaceRootPath: string
}): ArtifactCandidate[] => {
  const merged = new Map<
    string,
    { requestedOperation?: AiFileArtifactOperation; summary?: string }
  >()

  const commandCandidates = input.commandCandidates.map((item) => ({
    path: item.rawPath,
    operation: item.operation,
    summary: undefined
  }))
  const explicitCandidates = input.expectedArtifacts.map((item) => ({
    path: item.path,
    operation: item.operation,
    summary: item.summary
  }))

  for (const item of [...commandCandidates, ...explicitCandidates]) {
    const resolved = resolveWorkspacePath({
      rawPath: item.path,
      cwd: input.cwd,
      rootPath: input.workspaceRootPath
    })
    if (!resolved) continue
    const previous = merged.get(resolved)
    if (!previous) {
      merged.set(resolved, {
        requestedOperation: item.operation,
        summary: item.summary
      })
      continue
    }
    merged.set(resolved, {
      requestedOperation: previous.requestedOperation || item.operation,
      summary: previous.summary || item.summary
    })
  }

  return Array.from(merged.entries()).map(([resolvedPath, meta]) => ({
    resolvedPath,
    summary:
      meta.summary || `terminal command produced/updated file: ${path.basename(resolvedPath)}`,
    requestedOperation: meta.requestedOperation,
    existedBefore: fs.existsSync(resolvedPath)
  }))
}

export const recordTerminalArtifacts = (input: {
  ctx: TerminalToolContext
  runId: string
  taskId: string
  stepId: string
  candidates: ArtifactCandidate[]
  emitActivity: (activity: CapabilityActivityInput) => void
}): Array<{ path: string; operation: AiFileArtifactOperation }> => {
  const artifacts: Array<{ path: string; operation: AiFileArtifactOperation }> = []
  for (const artifact of input.candidates) {
    if (!fs.existsSync(artifact.resolvedPath)) continue
    const operation =
      artifact.requestedOperation || (artifact.existedBefore ? 'updated' : 'created')
    const emitted = emitFileArtifactEvent({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      capability: 'terminal_exec',
      artifactPath: artifact.resolvedPath,
      operation,
      summary: artifact.summary,
      stepId: input.stepId,
      onNonFatalError: (reason) => {
        input.emitActivity({
          actionType: 'file_artifact',
          status: 'failed',
          summary: reason
        })
      }
    })
    if (emitted) {
      artifacts.push({
        path: artifact.resolvedPath,
        operation
      })
    }
  }
  return artifacts
}
