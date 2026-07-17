import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiFileChangeRecord,
  AiFileArtifactOperation,
  AiFileArtifactRef,
  AiRunEvent,
  DocxApplyRecord,
  FileChangesSummary,
  JsonObject,
  JsonValue
} from '../../../../shared/types'
import type { ToolCallResult } from '../human/types'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}

const readNonEmptyString = (input: JsonObject, key: string): string | undefined => {
  const value = input[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const readArtifactOperation = (
  input: JsonObject,
  key: string,
  fallback: AiFileArtifactOperation
): AiFileArtifactOperation => {
  const value = input[key]
  return value === 'created' || value === 'updated' || value === 'deleted' || value === 'renamed'
    ? value
    : fallback
}

const createFileArtifactRef = (input: {
  capability: AiFileArtifactRef['capability']
  artifactPath: string
  operation: AiFileArtifactOperation
  summary: string
  applyId?: string
}): AiFileArtifactRef => ({
  kind: 'file',
  capability: input.capability,
  path: input.artifactPath,
  fileName: path.basename(input.artifactPath),
  operation: input.operation,
  applyId: input.applyId,
  summary: input.summary
})

const extractTerminalArtifacts = (result: ToolCallResult): AiArtifactRef[] => {
  if (result.toolName !== 'terminal_run' || !isJsonObject(result.data)) return []
  const rawArtifacts = result.data.artifacts
  if (!Array.isArray(rawArtifacts)) return []
  return rawArtifacts.flatMap((item) => {
    if (!isJsonObject(item)) return []
    const artifactPath = readNonEmptyString(item, 'path')
    if (!artifactPath) return []
    return [
      createFileArtifactRef({
        capability: 'terminal_exec',
        artifactPath,
        operation: readArtifactOperation(item, 'operation', 'created'),
        summary:
          readNonEmptyString(item, 'summary') ||
          `terminal command produced/updated file: ${path.basename(artifactPath)}`
      })
    ]
  })
}

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

export const extractArtifactRefsFromToolResult = (result: ToolCallResult): AiArtifactRef[] =>
  mergeArtifactRefs(extractTerminalArtifacts(result))

export const extractArtifactRefsFromToolResults = (
  results: readonly ToolCallResult[]
): AiArtifactRef[] =>
  mergeArtifactRefs(...results.map((result) => extractArtifactRefsFromToolResult(result)))

export const buildRunArtifactsFromDocxApplyRecord = (record: DocxApplyRecord): AiArtifactRef[] => [
  createFileArtifactRef({
    capability: 'docx',
    artifactPath: record.source_path,
    operation: record.operation,
    applyId: record.id,
    summary: `docx applied: ${record.source_name}`
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
      summary: `docx applied: ${record.source_name}`,
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
        applyId: record.id,
        summary: `${record.capability} applied: ${record.fileName}`
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
      summary: `${record.capability} applied: ${record.fileName}`,
      createdAt: Date.now()
    })
  })
  return nextArtifacts
}

export const buildFileChangesSummaryFromDocxApplyRecords = (
  records: readonly DocxApplyRecord[]
): FileChangesSummary => ({
  changed_files: records.map((record) =>
    toFileChangeSummaryItem(toAiFileChangeRecordFromDocxApply(record))
  )
})

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
  sessionId: record.session_id,
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
