import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiFileArtifactCapability, AiFileArtifactOperation } from '../../../../shared/types'
import type { AiRunContext } from '../types'

type EmitFileArtifactEventInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
  capability: AiFileArtifactCapability
  artifactPath: string
  operation: AiFileArtifactOperation
  artifactRole?: 'preview' | 'draft' | 'committed'
  reviewId?: string
  draftDocumentId?: string
  draftSnapshotId?: string
  summary: string
  stepId?: string
  onNonFatalError?: (reason: string) => void
}

export const emitFileArtifactEvent = (input: EmitFileArtifactEventInput): boolean => {
  try {
    input.ctx.sendEvent({
      type: 'file_artifact',
      runId: input.runId,
      taskId: input.taskId,
      artifactId: randomUUID(),
      capability: input.capability,
      path: input.artifactPath,
      fileName: path.basename(input.artifactPath),
      operation: input.operation,
      artifactRole: input.artifactRole,
      reviewId: input.reviewId,
      draftDocumentId: input.draftDocumentId,
      draftSnapshotId: input.draftSnapshotId,
      summary: input.summary,
      stepId: input.stepId,
      createdAt: Date.now()
    })
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    input.onNonFatalError?.(`artifact event failed: ${msg}`)
    return false
  }
}
