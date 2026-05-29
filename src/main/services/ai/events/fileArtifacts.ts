import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AiFileArtifactCapability, AiFileArtifactOperation } from '../../../../shared/types'
import type { AiEventDispatchContext } from '../types'

export type EmitFileArtifactEventInput = {
  ctx: AiEventDispatchContext
  runId: string
  taskId: string
  capability: AiFileArtifactCapability
  artifactPath: string
  operation: AiFileArtifactOperation
  applyId?: string
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
      applyId: input.applyId,
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
