import type { AiFileArtifactCapability, AiFileArtifactOperation } from '../../../../shared/types'
import type { AiEventDispatchContext } from '../types'

export type EmitFileArtifactEventInput = {
  ctx: AiEventDispatchContext
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
