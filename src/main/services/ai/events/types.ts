import type { AiFileArtifactCapability, AiFileArtifactOperation } from '../../../../shared/types'
import type { AiRunContext } from '../types'

export type EmitFileArtifactEventInput = {
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
