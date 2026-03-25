import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  JsonObject,
  DraftReviewSummary
} from '../../../../../../../shared/types'
import type { DocumentsStore } from '../../../../../storage/domains/DocumentsStore'
import type { DocxChangedBlock, DocxOp } from '../types'
import { getDocxWorkerClient } from '../worker/docxWorkerClient'
import {
  buildDocxChangeLocator,
  buildDocxChangeSummary,
  buildDocxChangeTitle,
  buildSourceVersion,
  getDocxChangeKind,
  sanitizeFileName
} from './utils'
import { clipText } from '../../../../utils/text'

type RunDraftChangeSeed = {
  id: string
  orderIndex: number
  changeKind: DraftReviewChange['change_kind']
  title: string
  summary: string
  beforeText: string
  afterText: string
  locator: JsonObject
  metadata: JsonObject
}

type RunDraftDocument = {
  sourcePath: string
  sourceName: string
  initialDocId: string
  latestDocId: string
  previewArtifactPath?: string
  changes: RunDraftChangeSeed[]
}

type RunDraftState = {
  sessionId: string
  inputText: string
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
      inputText: input.inputText,
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
        }
      })
    })
  }

  public registerDocxPreview(input: { runId: string; docId: string; previewPath: string }): void {
    const state = this.runDrafts.get(input.runId)
    if (!state) return

    const sourcePath = state.sourcePathByDocId.get(input.docId)
    if (!sourcePath) return

    const document = state.documentBySourcePath.get(sourcePath)
    if (!document) return

    document.previewArtifactPath = input.previewPath
  }

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<DraftReviewDetail | null> {
    const state = this.runDrafts.get(input.runId)
    if (!state) return null

    const changedDocuments = [...state.documentBySourcePath.values()].filter(
      (document) => document.changes.length > 0
    )
    if (changedDocuments.length === 0) {
      this.runDrafts.delete(input.runId)
      return null
    }

    const reviewId = randomUUID()
    const now = Date.now()
    const client = getDocxWorkerClient()
    const documents: DraftReviewDocument[] = []
    const changes: DraftReviewChange[] = []

    for (const [index, document] of changedDocuments.entries()) {
      const draftDir = path.join(
        path.resolve(input.workspaceRootPath),
        '.ncurator',
        'draft-reviews',
        reviewId
      )
      const draftPath = path.join(
        draftDir,
        `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(document.sourceName)}`
      )
      const saveResponse = await client.call({
        runId: input.runId,
        action: 'save',
        payload: {
          docId: document.latestDocId,
          outPath: draftPath
        }
      })
      if (!saveResponse.ok || saveResponse.payload.action !== 'save') {
        throw new Error(
          saveResponse.ok ? 'draft save worker protocol mismatch' : saveResponse.error
        )
      }

      const sourceDocument = await this.documentsStore.getDocumentByFilePath(document.sourcePath)
      const sourceVersion = await buildSourceVersion(document.sourcePath)
      const documentId = randomUUID()
      documents.push({
        id: documentId,
        review_id: reviewId,
        source_document_id: sourceDocument?.id,
        source_path: document.sourcePath,
        source_name: document.sourceName,
        format: 'docx',
        latest_draft_snapshot_id: document.latestDocId,
        preview_artifact_path: document.previewArtifactPath,
        draft_artifact_path: draftPath,
        source_version: sourceVersion,
        total_change_count: document.changes.length,
        pending_change_count: document.changes.length,
        accepted_change_count: 0,
        rejected_change_count: 0,
        created_at: now,
        updated_at: now
      })

      document.changes.forEach((change) => {
        changes.push({
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
          locator: change.locator,
          preview_artifact_path: document.previewArtifactPath,
          metadata: change.metadata,
          created_at: now,
          updated_at: now
        })
      })
    }

    const review: DraftReviewSummary = {
      id: reviewId,
      session_id: state.sessionId,
      run_id: input.runId,
      status: 'review_pending',
      title: clipText(state.inputText, 80) || '文档草稿审阅',
      document_count: documents.length,
      change_count: changes.length,
      pending_change_count: changes.length,
      accepted_change_count: 0,
      rejected_change_count: 0,
      created_at: now,
      updated_at: now,
      completed_at: now
    }

    this.runDrafts.delete(input.runId)
    return {
      review,
      documents,
      changes,
      commit_jobs: []
    }
  }
}
