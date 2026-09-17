import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiFileChangeRecord,
  AiFileArtifactOperation,
  AiFileArtifactRef,
  AiRunEvent,
  DocxApplyRecord,
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

export const extractArtifactRefsFromToolResult = (_result: ToolCallResult): AiArtifactRef[] => []

export const extractArtifactRefsFromToolResults = (
  results: readonly ToolCallResult[]
): AiArtifactRef[] =>
  mergeArtifactRefs(...results.map((result) => extractArtifactRefsFromToolResult(result)))

export const buildRunArtifactsFromDocxApplyRecord = (record: DocxApplyRecord): AiArtifactRef[] => [
  createFileArtifactRef({
    capability: 'docx',
    artifactPath: record.source_path,
    operation: record.operation,
    applyId: record.id
  })
]

export const appendDocxApplyArtifactsAndEmitEvents = (input: {
  existingArtifacts?: readonly AiArtifactRef[]
  records: readonly DocxApplyRecord[]
  sendEvent: (event: AiRunEvent) => void
  runId: string
  taskId: string
}): AiArtifactRef[] => {
  const nextArtifacts = mergeArtifactRefs(
    input.existingArtifacts,
    ...input.records.map((record) => buildRunArtifactsFromDocxApplyRecord(record))
  )

  input.records.forEach((record) => {
    input.sendEvent({
      type: 'file_artifact',
      runId: input.runId,
      taskId: input.taskId,
      artifactId: uuidv4(),
      capability: 'docx',
      path: record.source_path,
      fileName: record.source_name,
      operation: record.operation,
      applyId: record.id,
      changeCount: record.change_count,
      insertCount: record.insert_count,
      deleteCount: record.delete_count,
      createdAt: Date.now()
    })
  })

  return nextArtifacts
}

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

export const toAiFileChangeRecordFromDocxApply = (record: DocxApplyRecord): AiFileChangeRecord => ({
  id: record.id,
  partnerId: record.partner_id,
  runId: record.run_id,
  status: record.status,
  capability: 'docx',
  path: record.source_path,
  fileName: record.source_name,
  operation: record.operation,
  source: 'docx_tool',
  beforePath: record.operation === 'updated' ? record.source_path : undefined,
  afterPath: record.source_path,
  changeCount: record.change_count,
  insertCount: record.insert_count,
  deleteCount: record.delete_count,
  beforeSnapshotPath: record.before_snapshot_path,
  beforeChecksum: record.before_checksum,
  afterChecksum: record.after_checksum,
  previewPath: record.preview_diff_artifact_path,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
  revertedAt: record.reverted_at,
  error: record.error
})
