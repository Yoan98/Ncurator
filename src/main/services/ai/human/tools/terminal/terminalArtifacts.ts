import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiFileArtifactOperation } from '../../../../../../shared/types'
import type { ArtifactCandidate, PreparedArtifactCandidate, TerminalArtifactCandidate } from './types'
import { resolveWorkspacePath } from './commandPolicy'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { TerminalToolContext } from '../../../types'
import type { CapabilityActivityInput } from '../types'
import { calculateFileStats } from '../docx/review/utils'

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

export const recordTerminalArtifacts = async (input: {
  ctx: TerminalToolContext
  runId: string
  sessionId: string
  taskId: string
  stepId: string
  candidates: PreparedArtifactCandidate[]
  emitActivity: (activity: CapabilityActivityInput) => void
}): Promise<Array<{ path: string; operation: AiFileArtifactOperation }>> => {
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
      try {
        const now = Date.now()
        const afterStats = await calculateFileStats(artifact.resolvedPath)
        await input.ctx.saveFileChangeRecord({
          id: randomUUID(),
          sessionId: input.sessionId,
          runId: input.runId,
          status: 'applied',
          capability: 'terminal_exec',
          path: artifact.resolvedPath,
          fileName: path.basename(artifact.resolvedPath),
          operation,
          changeCount: 1,
          insertCount: operation === 'created' ? 1 : 0,
          deleteCount: 0,
          beforeSnapshotPath: artifact.beforeSnapshotPath,
          beforeChecksum: artifact.beforeChecksum,
          afterChecksum: afterStats.checksum,
          createdAt: now,
          updatedAt: now
        })
      } catch (error) {
        input.emitActivity({
          actionType: 'file_change_record',
          status: 'failed',
          summary: error instanceof Error ? error.message : String(error)
        })
      }
      artifacts.push({
        path: artifact.resolvedPath,
        operation
      })
    }
  }
  return artifacts
}

export const prepareTerminalArtifactCandidates = async (input: {
  candidates: ArtifactCandidate[]
  runId: string
  workspaceRootPath: string
}): Promise<PreparedArtifactCandidate[]> => {
  const snapshotRoot = path.join(input.workspaceRootPath, '.ncurator', 'file-change-snapshots', input.runId)
  const prepared: PreparedArtifactCandidate[] = []
  for (const candidate of input.candidates) {
    if (!candidate.existedBefore || !fs.existsSync(candidate.resolvedPath)) {
      prepared.push(candidate)
      continue
    }
    const stats = await calculateFileStats(candidate.resolvedPath)
    const snapshotPath = path.join(snapshotRoot, `${randomUUID()}-${path.basename(candidate.resolvedPath)}`)
    await fsPromises.mkdir(path.dirname(snapshotPath), { recursive: true })
    await fsPromises.copyFile(candidate.resolvedPath, snapshotPath)
    prepared.push({
      ...candidate,
      beforeSnapshotPath: snapshotPath,
      beforeChecksum: stats.checksum
    })
  }
  return prepared
}
