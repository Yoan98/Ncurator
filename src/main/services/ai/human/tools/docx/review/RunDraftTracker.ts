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
import { DOCX_CONFIRM_ANCHOR_PREFIX } from './constants'
import { materializeDocxConfirmCopy } from './confirmCopy'
import type { RunDraftDocument } from './types'
import {
  buildDocxChangeLocator,
  buildDocxChangeSummary,
  buildDocxChangeTitle,
  buildSourceVersion,
  getDocxChangeKind,
  getManifestPathForConfirmArtifact,
  sanitizeFileName
} from './utils'
import { clipText } from '../../../../utils/text'

type RunDraftState = {
  sessionId: string
  documentBySourcePath: Map<string, RunDraftDocument>
  sourcePathByDocId: Map<string, string>
  orderCounter: number
}

export class RunDraftTracker {
  private readonly runDrafts = new Map<string, RunDraftState>()

  public constructor(private readonly documentsStore: DocumentsStore) {}

  public beginRun(input: { runId: string; sessionId: string; inputText: string }): void {
    this.runDrafts.set(input.runId, {
      sessionId: input.sessionId,
      documentBySourcePath: new Map(),
      sourcePathByDocId: new Map(),
      orderCounter: 0
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
      initialDocId: input.docId,
      latestDocId: input.docId,
      changes: []
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
    const groupId = randomUUID()

    input.changedBlocks.forEach((change) => {
      state.orderCounter += 1
      document.changes.push({
        id: randomUUID(),
        orderIndex: state.orderCounter,
        changeKind: getDocxChangeKind(input.op),
        title: buildDocxChangeTitle(input.op, change),
        summary: buildDocxChangeSummary(input.op, change),
        beforeText: change.beforeText,
        afterText: change.afterText,
        locator: buildDocxChangeLocator(change),
        metadata: {
          engine: 'docx_change_v1',
          group_id: groupId,
          docx_op_json: JSON.stringify(input.op),
          previous_doc_id: input.previousDocId,
          next_doc_id: input.nextDocId
        },
        anchorName: `${DOCX_CONFIRM_ANCHOR_PREFIX}${randomUUID().replace(/-/g, '')}`,
        docxOp: input.op
      })
    })
  }

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<DraftReviewDetail[]> {
    const state = this.runDrafts.get(input.runId)
    if (!state) return []

    const changedDocuments = [...state.documentBySourcePath.values()].filter(
      (document) => document.changes.length > 0
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
      const draftDir = path.join(
        path.resolve(input.workspaceRootPath),
        '.ncurator',
        'draft-reviews',
        reviewId
      )
      const basePath = path.join(
        draftDir,
        `${String(index + 1).padStart(2, '0')}-base-${sanitizeFileName(document.sourceName)}`
      )
      const confirmPath = path.join(
        draftDir,
        `${String(index + 1).padStart(2, '0')}-confirm-${sanitizeFileName(document.sourceName)}`
      )
      const effectiveDraftPath = path.join(
        draftDir,
        `${String(index + 1).padStart(2, '0')}-effective-${sanitizeFileName(document.sourceName)}`
      )
      const manifestPath = getManifestPathForConfirmArtifact(confirmPath)

      const baseSaveResponse = await client.call({
        runId: input.runId,
        action: 'save',
        payload: {
          docId: document.initialDocId,
          outPath: basePath
        }
      })
      if (!baseSaveResponse.ok || baseSaveResponse.payload.action !== 'save') {
        throw new Error(
          baseSaveResponse.ok ? 'draft base save worker protocol mismatch' : baseSaveResponse.error
        )
      }
      const effectiveSaveResponse = await client.call({
        runId: input.runId,
        action: 'save',
        payload: {
          docId: document.latestDocId,
          outPath: effectiveDraftPath
        }
      })
      if (!effectiveSaveResponse.ok || effectiveSaveResponse.payload.action !== 'save') {
        throw new Error(
          effectiveSaveResponse.ok
            ? 'draft effective save worker protocol mismatch'
            : effectiveSaveResponse.error
        )
      }

      const sourceDocument = await this.documentsStore.getDocumentByFilePath(document.sourcePath)
      const sourceVersion = await buildSourceVersion(document.sourcePath)
      const documentId = randomUUID()
      const baseBuffer = await fs.readFile(basePath)
      await materializeDocxConfirmCopy({
        baseBuffer,
        confirmArtifactPath: confirmPath,
        manifestArtifactPath: manifestPath,
        reviewId,
        sourcePath: document.sourcePath,
        sourceName: document.sourceName,
        latestDraftSnapshotId: document.latestDocId,
        sourceVersion,
        changes: document.changes,
        createdAt: now
      })
      await fs.rm(basePath, { force: true })

      const reviewDocument: DraftReviewDocument = {
        id: documentId,
        review_id: reviewId,
        source_document_id: sourceDocument?.id,
        source_path: document.sourcePath,
        source_name: document.sourceName,
        format: 'docx',
        latest_draft_snapshot_id: document.latestDocId,
        confirm_artifact_path: confirmPath,
        manifest_artifact_path: manifestPath,
        effective_draft_artifact_path: effectiveDraftPath,
        source_version: sourceVersion,
        total_change_count: document.changes.length,
        pending_change_count: document.changes.length,
        accepted_change_count: 0,
        rejected_change_count: 0,
        created_at: now,
        updated_at: now
      }

      const reviewChanges: DraftReviewChange[] = document.changes.map((change) => ({
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
