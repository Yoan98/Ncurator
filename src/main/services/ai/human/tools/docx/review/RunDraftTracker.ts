import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewSummary
} from '../../../../../../../shared/types'
import type { DocumentsStore } from '../../../../../storage/domains/DocumentsStore'
import type { DocxChangedBlock, DocxOp } from '../types'
import { getDocxWorkerClient } from '../worker/docxWorkerClient'
import { materializeDocxConfirmCopy } from './confirmCopy'
import { computeCumulativeDocxChangeSeeds } from './cumulativeDiff'
import type { RunDraftDocument } from './types'
import { buildSourceVersion } from './utils'
import { buildDocxReviewArtifactPaths } from './viewProjection'
import { clipText } from '../../../../utils/text'

type RunDraftState = {
  sessionId: string
  documentBySourcePath: Map<string, RunDraftDocument>
  sourcePathByDocId: Map<string, string>
}

export class RunDraftTracker {
  private readonly runDrafts = new Map<string, RunDraftState>()

  public constructor(private readonly documentsStore: DocumentsStore) {}

  public beginRun(input: { runId: string; sessionId: string; inputText: string }): void {
    this.runDrafts.set(input.runId, {
      sessionId: input.sessionId,
      documentBySourcePath: new Map(),
      sourcePathByDocId: new Map()
    })
  }

  public discardRun(runId: string): void {
    this.runDrafts.delete(runId)
  }

  public registerDocxOpen(input: { runId: string; docId: string; sourcePath: string }): void {
    const state = this.runDrafts.get(input.runId)
    if (!state) return

    const sourcePath = path.resolve(input.sourcePath)
    const existing = state.documentBySourcePath.get(sourcePath)
    if (existing) {
      existing.latestDocId = input.docId
      state.sourcePathByDocId.set(input.docId, sourcePath)
      return
    }

    state.documentBySourcePath.set(sourcePath, {
      sourcePath,
      sourceName: path.basename(sourcePath),
      latestDocId: input.docId,
      dirtyChangeCount: 0
    })
    state.sourcePathByDocId.set(input.docId, sourcePath)
  }

  public registerDocxChanges(input: {
    runId: string
    previousDocId: string
    nextDocId: string
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
  }): void {
    const state = this.runDrafts.get(input.runId)
    if (!state || input.changedBlocks.length === 0) return

    const sourcePath = state.sourcePathByDocId.get(input.previousDocId)
    if (!sourcePath) return

    const document = state.documentBySourcePath.get(sourcePath)
    if (!document) return

    state.sourcePathByDocId.set(input.nextDocId, sourcePath)
    document.latestDocId = input.nextDocId
    document.dirtyChangeCount += input.changedBlocks.length
  }

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<DraftReviewDetail[]> {
    const state = this.runDrafts.get(input.runId)
    if (!state) return []

    const changedDocuments = [...state.documentBySourcePath.values()].filter(
      (document) => document.dirtyChangeCount > 0
    )
    if (changedDocuments.length === 0) {
      this.runDrafts.delete(input.runId)
      return []
    }

    const client = getDocxWorkerClient()
    const details: DraftReviewDetail[] = []

    for (const [index, document] of changedDocuments.entries()) {
      const reviewId = randomUUID()
      const now = Date.now()
      const { reviewArtifactPath, workingArtifactPath, manifestArtifactPath } =
        buildDocxReviewArtifactPaths({
          workspaceRootPath: input.workspaceRootPath,
          reviewId,
          documentIndex: index,
          sourceName: document.sourceName
        })

      const effectiveSaveResponse = await client.call({
        runId: input.runId,
        action: 'materialize_draft',
        payload: {
          docId: document.latestDocId,
          outPath: workingArtifactPath
        }
      })
      if (
        !effectiveSaveResponse.ok ||
        effectiveSaveResponse.payload.action !== 'materialize_draft'
      ) {
        throw new Error(
          effectiveSaveResponse.ok
            ? 'draft materialization worker protocol mismatch'
            : effectiveSaveResponse.error
        )
      }

      const sourceDocument = await this.documentsStore.getDocumentByFilePath(document.sourcePath)
      const sourceVersion = await buildSourceVersion(document.sourcePath)
      const documentId = randomUUID()
      const sourceBuffer = await fs.readFile(document.sourcePath)
      const latestDraftBuffer = await fs.readFile(workingArtifactPath)
      const cumulativeChanges = await computeCumulativeDocxChangeSeeds({
        sourceBuffer,
        latestDraftBuffer,
        latestDraftSnapshotId: document.latestDocId
      })

      if (cumulativeChanges.length === 0) {
        continue
      }

      await materializeDocxConfirmCopy({
        baseBuffer: sourceBuffer,
        confirmArtifactPath: reviewArtifactPath,
        manifestArtifactPath,
        reviewId,
        sourcePath: document.sourcePath,
        sourceName: document.sourceName,
        latestDraftSnapshotId: document.latestDocId,
        sourceVersion,
        changes: cumulativeChanges,
        createdAt: now
      })

      const reviewDocument: DraftReviewDocument = {
        id: documentId,
        review_id: reviewId,
        source_document_id: sourceDocument?.id,
        source_path: document.sourcePath,
        source_name: document.sourceName,
        format: 'docx',
        latest_draft_snapshot_id: document.latestDocId,
        review_artifact_path: reviewArtifactPath,
        working_artifact_path: workingArtifactPath,
        source_version: sourceVersion,
        total_change_count: cumulativeChanges.length,
        pending_change_count: cumulativeChanges.length,
        accepted_change_count: 0,
        rejected_change_count: 0,
        created_at: now,
        updated_at: now
      }

      const reviewChanges: DraftReviewChange[] = cumulativeChanges.map((change) => ({
          id: change.id,
          review_id: reviewId,
          document_id: documentId,
          order_index: change.orderIndex,
          change_kind: change.changeKind,
          title: change.title,
          summary: change.summary,
          decision: 'pending',
          before_text: change.beforeText,
          after_text: change.afterText,
          anchor_name: change.anchorName,
          locator: change.locator,
          metadata: change.metadata,
          created_at: now,
          updated_at: now
      }))

      const review: DraftReviewSummary = {
        id: reviewId,
        session_id: state.sessionId,
        run_id: input.runId,
        status: 'pending_confirm',
        title: clipText(`确认文档：${document.sourceName}`, 80) || '确认文档',
        document_count: 1,
        change_count: reviewChanges.length,
        pending_change_count: reviewChanges.length,
        accepted_change_count: 0,
        rejected_change_count: 0,
        created_at: now,
        updated_at: now,
        completed_at: now
      }

      details.push({
        review,
        documents: [reviewDocument],
        changes: reviewChanges,
        commit_jobs: []
      })
    }

    this.runDrafts.delete(input.runId)
    return details
  }
}
