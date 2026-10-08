import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiFileChangeRecord,
  AiFileArtifactOperation,
  AiFileArtifactRef,
  AiRunEvent,
  FileChangesSummary
} from '../../../../shared/types'
import type { ToolCallResult } from '../human/types'

const createFileArtifactRef = (input: {
  capability: AiFileArtifactRef['capability']
  artifactPath: string
  operation: AiFileArtifactOperation
  applyId?: string
}): AiFileArtifactRef => ({
  kind: 'file',
  capability: input.capability,
  path: input.artifactPath,
  fileName: path.basename(input.artifactPath),
  operation: input.operation,
  applyId: input.applyId
})

const getArtifactKey = (artifact: AiArtifactRef): string =>
  `file:${artifact.path}:${artifact.applyId || ''}`

export const mergeArtifactRefs = (
  ...groups: Array<readonly AiArtifactRef[] | undefined>
): AiArtifactRef[] => {
  const merged = new Map<string, AiArtifactRef>()
  groups.forEach((group) => {
    group?.forEach((artifact) => {
      const key = getArtifactKey(artifact)
      if (merged.has(key)) merged.delete(key)
      merged.set(key, artifact)
    })
  })
  return Array.from(merged.values())
}

export const extractArtifactRefsFromToolResult = (result: ToolCallResult): AiArtifactRef[] => {
  void result
  return []
}

export const extractArtifactRefsFromToolResults = (
  results: readonly ToolCallResult[]
): AiArtifactRef[] =>
  mergeArtifactRefs(...results.map((result) => extractArtifactRefsFromToolResult(result)))

export const appendFileChangeArtifactsAndEmitEvents = (input: {
  existingArtifacts?: readonly AiArtifactRef[]
  records: readonly AiFileChangeRecord[]
  sendEvent: (event: AiRunEvent) => void
  runId: string
  taskId: string
}): AiArtifactRef[] => {
  const nextArtifacts = mergeArtifactRefs(
    input.existingArtifacts,
    ...input.records.map((record) => [
      createFileArtifactRef({
        capability: record.capability,
        artifactPath: record.path,
        operation: record.operation,
        applyId: record.id
      })
    ])
  )

  input.records.forEach((record) => {
    input.sendEvent({
      type: 'file_artifact',
      runId: input.runId,
      taskId: input.taskId,
      artifactId: uuidv4(),
      capability: record.capability,
      path: record.path,
      fileName: record.fileName,
      operation: record.operation,
      applyId: record.id,
      changeCount: record.changeCount,
      insertCount: record.insertCount,
      deleteCount: record.deleteCount,
      createdAt: Date.now()
    })
  })
  return nextArtifacts
}

export const buildFileChangesSummaryFromFileChangeRecords = (
  records: readonly AiFileChangeRecord[]
): FileChangesSummary => ({
  changed_files: records.map(toFileChangeSummaryItem)
})

const toFileChangeSummaryItem = (
  record: AiFileChangeRecord
): FileChangesSummary['changed_files'][number] => ({
  id: record.id,
  fileName: record.fileName,
  path: record.path,
  capability: record.capability,
  operation: record.operation,
  changeCount: record.changeCount,
  insertCount: record.insertCount,
  deleteCount: record.deleteCount,
  status: record.status
})
