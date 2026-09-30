import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { DocxApplyRecord } from '../../../../../../../shared/types'
import type { DocxApplyStore } from '../../../../../storage/domains/DocxApplyStore'
import type { DocxChangedNode, DocxCreatedNode, DocxReplaySession } from '../types'
import { getDocxWorkerClient } from '../worker/docxWorkerClient'
import { materializeDocxProjectedArtifact, materializeDocxNetReview } from './reviewSerializer'
import type { RunDocxEditDocument } from './types'
import { buildDocxChangeSummary, calculateFileStats, sanitizeFileName } from './utils'
import { buildDocxApplyArtifactPaths } from './viewProjection'
import { projectReviewView } from './viewProjector'

type RunDocxEditState = {
  partnerId: string
  ownerRunId: string
  documentBySourcePath: Map<string, RunDocxEditDocument>
  sourcePathByDocId: Map<string, string>
}

type DocxChangeStats = {
  insertCount: number
  deleteCount: number
}

export class RunDocxEditTracker {
  private readonly runEdits = new Map<string, RunDocxEditState>()

  public constructor(private readonly docxApplyStore: DocxApplyStore) {}

  public beginRun(input: {
    runId: string
    ownerRunId?: string
    partnerId: string
    inputText: string
  }): void {
    this.runEdits.set(input.runId, {
      partnerId: input.partnerId,
      ownerRunId: input.ownerRunId || input.runId,
      documentBySourcePath: new Map(),
      sourcePathByDocId: new Map()
    })
  }

  public discardRun(runId: string): void {
    this.runEdits.delete(runId)
  }

  public registerDocxOpen(input: {
    runId: string
    docId: string
    sourcePath: string
    replaySession?: DocxReplaySession
  }): void {
    const state = this.runEdits.get(input.runId)
    if (!state) return

    const sourcePath = path.resolve(input.sourcePath)
    const existing = state.documentBySourcePath.get(sourcePath)
    if (existing) {
      existing.latestDocId = input.docId
      existing.replaySession = input.replaySession || existing.replaySession
      state.sourcePathByDocId.set(input.docId, sourcePath)
      return
    }

    state.documentBySourcePath.set(sourcePath, {
      sourcePath,
      sourceName: path.basename(sourcePath),
      latestDocId: input.docId,
      dirtyChangeCount: 0,
      replaySession: input.replaySession
    })
    state.sourcePathByDocId.set(input.docId, sourcePath)
  }

  public registerDocxChanges(input: {
    runId: string
    previousDocId: string
    nextDocId: string
    changedNodes: DocxChangedNode[]
    createdNodes: DocxCreatedNode[]
    replaySession?: DocxReplaySession
  }): void {
    const state = this.runEdits.get(input.runId)
    if (!state) return

    const sourcePath = state.sourcePathByDocId.get(input.previousDocId)
    if (!sourcePath) return
    const document = state.documentBySourcePath.get(sourcePath)
    if (!document) return
    const packageChanged = Boolean(
      input.replaySession &&
      input.replaySession.sourceSnapshot.packageFingerprint !==
        input.replaySession.activeSnapshot.packageFingerprint
    )
    if (input.changedNodes.length === 0 && !packageChanged) return

    state.sourcePathByDocId.set(input.nextDocId, sourcePath)
    document.latestDocId = input.nextDocId
    document.dirtyChangeCount += Math.max(1, input.changedNodes.length)
    document.replaySession = input.replaySession || document.replaySession
  }

  public async applyRunEdits(input: {
    retainState?: boolean
    runId: string
    partnerId: string
  }): Promise<DocxApplyRecord[]> {
    const state = this.runEdits.get(input.runId)
    if (!state) return []

    const changedDocuments = [...state.documentBySourcePath.values()].filter((document) => {
      const packageChanged = Boolean(
        document.replaySession &&
        document.replaySession.sourceSnapshot.packageFingerprint !==
          document.replaySession.activeSnapshot.packageFingerprint
      )
      if (
        document.dirtyChangeCount <= 0 ||
        !document.replaySession ||
        (!packageChanged &&
          !projectReviewView(document.replaySession).some((node) => node.reviewState !== 'normal'))
      ) {
        return false
      }
      return true
    })
    if (changedDocuments.length === 0) {
      if (!input.retainState) this.runEdits.delete(input.runId)
      return []
    }

    const records: DocxApplyRecord[] = []
    try {
      for (const document of changedDocuments) {
        const record = await this.applyDocument({
          runId: input.runId,
          ownerRunId: state.ownerRunId,
          partnerId: state.partnerId,
          document
        })
        const existing = (
          await this.docxApplyStore.listRecords({ partnerId: state.partnerId })
        ).items.find(
          (item) =>
            item.run_id === state.ownerRunId &&
            item.source_path === record.source_path &&
            item.status === 'applied'
        )
        if (existing?.before_snapshot_path && existing.before_checksum !== record.before_checksum) {
          const net = await materializeDocxNetReview({
            sourceBuffer: await fs.readFile(existing.before_snapshot_path),
            workingBuffer: await fs.readFile(record.source_path),
            outPath: record.preview_diff_artifact_path
          })
          const stats = await calculateFileStats(record.preview_diff_artifact_path)
          Object.assign(record, {
            insert_count: net.insertCount,
            delete_count: net.deleteCount,
            change_count: net.insertCount + net.deleteCount,
            preview_diff_checksum: stats.checksum,
            preview_diff_byte_size: stats.byteSize
          })
        }
        if (existing)
          Object.assign(record, {
            id: existing.id,
            operation: existing.operation,
            before_exists: existing.before_exists,
            before_snapshot_path: existing.before_snapshot_path,
            before_checksum: existing.before_checksum,
            before_byte_size: existing.before_byte_size,
            before_modified_at: existing.before_modified_at,
            created_at: existing.created_at
          })
        await this.docxApplyStore.saveRecord(record)
        records.push(record)
      }
    } finally {
      if (!input.retainState) this.runEdits.delete(input.runId)
    }

    return records
  }

  private async applyDocument(input: {
    ownerRunId: string
    runId: string
    partnerId: string
    document: RunDocxEditDocument
  }): Promise<DocxApplyRecord> {
    const replaySession = input.document.replaySession
    if (!replaySession) throw new Error('docx replay session missing')

    const applyId = randomUUID()
    const now = Date.now()
    const paths = buildDocxApplyArtifactPaths({
      partnerId: input.partnerId,
      runId: input.ownerRunId,
      applyId,
      sourceName: input.document.sourceName
    })
    const sourceArtifactPath = path.join(
      paths.workDir,
      `source-${sanitizeFileName(input.document.sourceName)}`
    )
    const client = getDocxWorkerClient()

    const sourceSaveResponse = await client.call({
      runId: input.runId,
      action: 'materialize_draft',
      payload: {
        docId: replaySession.sourceDocId,
        outPath: sourceArtifactPath
      }
    })
    if (!sourceSaveResponse.ok || sourceSaveResponse.payload.action !== 'materialize_draft') {
      throw new Error(
        sourceSaveResponse.ok
          ? 'source materialization worker protocol mismatch'
          : sourceSaveResponse.error
      )
    }

    const workingSaveResponse = await client.call({
      runId: input.runId,
      action: 'materialize_draft',
      payload: {
        docId: input.document.latestDocId,
        outPath: paths.workingArtifactPath
      }
    })
    if (!workingSaveResponse.ok || workingSaveResponse.payload.action !== 'materialize_draft') {
      throw new Error(
        workingSaveResponse.ok
          ? 'committed materialization worker protocol mismatch'
          : workingSaveResponse.error
      )
    }

    const changeCount = this.countCommittedChanges(replaySession)
    const changeStats = this.countReviewChanges(replaySession)
    const sourceBuffer = await fs.readFile(sourceArtifactPath)
    const workingBuffer = await fs.readFile(paths.workingArtifactPath)
    await materializeDocxProjectedArtifact({
      sourceBuffer,
      workingBuffer,
      session: replaySession,
      kind: 'review',
      outPath: paths.diffArtifactPath
    })
    const diffStats = await calculateFileStats(paths.diffArtifactPath)

    const beforeExists = replaySession.targetMode === 'update'
    const operation = beforeExists ? 'updated' : 'created'
    let beforeChecksum: string | undefined
    let beforeByteSize: number | undefined
    let beforeModifiedAt: number | undefined
    let beforeSnapshotPath: string | undefined

    if (beforeExists) {
      await fs.mkdir(paths.workDir, { recursive: true })
      await fs.copyFile(sourceArtifactPath, paths.beforeSnapshotPath)
      const beforeStats = await calculateFileStats(sourceArtifactPath)
      beforeChecksum = beforeStats.checksum
      beforeByteSize = beforeStats.byteSize
      beforeModifiedAt = beforeStats.modifiedAt
      beforeSnapshotPath = paths.beforeSnapshotPath
    }

    const afterStats = {
      checksum: replaySession.diskFingerprint.checksum,
      byteSize: replaySession.diskFingerprint.byteSize,
      modifiedAt: replaySession.diskFingerprint.modifiedAt
    }

    try {
      await fs.rm(sourceArtifactPath, { force: true })
      await fs.rm(paths.workingArtifactPath, { force: true })
    } catch {
      // Ignore cleanup failures; checkpoint and diff artifacts are intentionally retained.
    }

    return {
      id: applyId,
      partner_id: input.partnerId,
      run_id: input.ownerRunId,
      status: 'applied',
      source_path: input.document.sourcePath,
      source_name: input.document.sourceName,
      operation,
      final_revision_ref: replaySession.activeRevisionRef,
      change_count: changeCount,
      insert_count: changeStats.insertCount,
      delete_count: changeStats.deleteCount,
      before_exists: beforeExists,
      before_snapshot_path: beforeSnapshotPath,
      before_checksum: beforeChecksum,
      before_byte_size: beforeByteSize,
      before_modified_at: beforeModifiedAt,
      preview_diff_artifact_path: paths.diffArtifactPath,
      preview_diff_checksum: diffStats.checksum,
      preview_diff_byte_size: diffStats.byteSize,
      after_checksum: afterStats.checksum,
      after_byte_size: afterStats.byteSize,
      after_modified_at: afterStats.modifiedAt,
      created_at: now,
      updated_at: Date.now()
    }
  }

  private countCommittedChanges(session: DocxReplaySession): number {
    const nodes = projectReviewView(session)
    const sourceChanges = new Set<string>()
    let generatedChanges = 0
    nodes.forEach((node) => {
      if (node.reviewState === 'normal') return
      if (node.tableCellChanges?.length) {
        generatedChanges += node.tableCellChanges.length
        return
      }
      if (node.sourceOrigin === 'source') {
        sourceChanges.add(node.sourceNodeId || node.nodeId)
      } else if (node.reviewState === 'inserted' || node.reviewState === 'replaced-new') {
        generatedChanges += 1
      }
    })
    const packageChanged =
      session.sourceSnapshot.packageFingerprint !== session.activeSnapshot.packageFingerprint
    return sourceChanges.size + generatedChanges + (packageChanged ? 1 : 0)
  }

  private countReviewChanges(session: DocxReplaySession): DocxChangeStats {
    const stats = projectReviewView(session).reduce<DocxChangeStats>(
      (stats, node) => {
        if (node.tableCellChanges?.length) {
          node.tableCellChanges.forEach((change) => {
            if (change.kind !== 'replaced') return
            stats.insertCount += 1
            stats.deleteCount += 1
          })
          return stats
        }
        if (node.reviewState === 'inserted' || node.reviewState === 'replaced-new') {
          stats.insertCount += 1
        }
        if (node.reviewState === 'deleted' || node.reviewState === 'replaced-old') {
          stats.deleteCount += 1
        }
        return stats
      },
      { insertCount: 0, deleteCount: 0 }
    )
    if (session.sourceSnapshot.packageFingerprint !== session.activeSnapshot.packageFingerprint) {
      stats.insertCount += 1
    }
    return stats
  }

  public buildChangeHighlights(session: DocxReplaySession): string[] {
    return [...session.revisionByDocId.values()]
      .filter((revision) => revision.revisionRef !== 'v1' && (revision.ops?.length || 0) > 0)
      .flatMap((revision) =>
        (revision.changedNodes || []).map((change, changeIndex) => {
          const op = revision.ops?.[changeIndex] || revision.ops?.[0]
          return op ? buildDocxChangeSummary(op, change) : revision.summary || '文档修改'
        })
      )
      .slice(0, 8)
  }
}
