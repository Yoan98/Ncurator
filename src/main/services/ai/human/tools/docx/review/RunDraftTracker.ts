import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  FileReview,
  FileReviewChange,
  FileReviewDetail
} from '../../../../../../../shared/types'
import type { DocumentsStore } from '../../../../../storage/domains/DocumentsStore'
import type { DocxChangedBlock, DocxCreatedBlock, DocxOp, DocxReplaySession } from '../types'
import { getDocxWorkerClient } from '../worker/docxWorkerClient'
import { materializeDocxProjectedArtifact } from './reviewSerializer'
import type { RunDraftDocument } from './types'
import {
  buildDocxChangeLocator,
  buildDocxChangeSummary,
  buildDocxChangeTitle,
  buildSourceVersion,
  getDocxChangeKind,
  sanitizeFileName
} from './utils'
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

  public registerDocxOpen(input: {
    runId: string
    docId: string
    sourcePath: string
    replaySession?: DocxReplaySession
  }): void {
    const state = this.runDrafts.get(input.runId)
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
    op: DocxOp
    changedBlocks: DocxChangedBlock[]
    createdBlocks: DocxCreatedBlock[]
    replaySession?: DocxReplaySession
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
    document.replaySession = input.replaySession || document.replaySession
  }

  public async finalizeRunReview(input: {
    runId: string
    workspaceRootPath: string
  }): Promise<FileReviewDetail[]> {
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
    const details: FileReviewDetail[] = []

    for (const document of changedDocuments) {
      const reviewId = randomUUID()
      const now = Date.now()
      const { draftArtifactPath, workingArtifactPath, committedArtifactPath } =
        buildDocxReviewArtifactPaths({
          workspaceRootPath: input.workspaceRootPath,
          reviewId,
          sourceName: document.sourceName
        })
      const sourceArtifactPath = path.join(
        path.dirname(workingArtifactPath),
        `source-${sanitizeFileName(document.sourceName)}`
      )

      const saveResponse = await client.call({
        runId: input.runId,
        action: 'materialize_draft',
        payload: {
          docId: document.latestDocId,
          outPath: workingArtifactPath
        }
      })
      if (!saveResponse.ok || saveResponse.payload.action !== 'materialize_draft') {
        throw new Error(
          saveResponse.ok ? 'draft materialization worker protocol mismatch' : saveResponse.error
        )
      }

      const replaySession = document.replaySession
      if (!replaySession) continue

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
            ? 'source draft materialization worker protocol mismatch'
            : sourceSaveResponse.error
        )
      }

      try {
        const sourceDocument = await this.documentsStore.getDocumentByFilePath(document.sourcePath)
        const sourceVersion = await buildSourceVersion(document.sourcePath)
        const sourceBuffer = await fs.readFile(sourceArtifactPath)
        const latestDraftBuffer = await fs.readFile(workingArtifactPath)
        const reviewChanges = this.buildReviewChanges({
          reviewId,
          session: replaySession,
          now
        })

        if (reviewChanges.length === 0) continue

        await materializeDocxProjectedArtifact({
          sourceBuffer,
          workingBuffer: latestDraftBuffer,
          session: replaySession,
          kind: 'review',
          outPath: draftArtifactPath
        })
        await materializeDocxProjectedArtifact({
          sourceBuffer,
          workingBuffer: latestDraftBuffer,
          session: replaySession,
          kind: 'committed',
          outPath: committedArtifactPath
        })

        replaySession.viewArtifacts.working = {
          kind: 'working',
          path: workingArtifactPath,
          createdAt: now
        }
        replaySession.viewArtifacts.review = {
          kind: 'review',
          path: draftArtifactPath,
          createdAt: now
        }
        replaySession.viewArtifacts.committed = {
          kind: 'committed',
          path: committedArtifactPath,
          createdAt: now
        }

        const review: FileReview = {
          id: reviewId,
          session_id: state.sessionId,
          run_id: input.runId,
          status: 'pending_confirm',
          title: clipText(`审阅稿：${document.sourceName}`, 80) || '审阅稿',
          source_document_id: sourceDocument?.id,
          source_path: document.sourcePath,
          source_name: document.sourceName,
          output_operation: replaySession.targetMode === 'create' ? 'created' : 'updated',
          format: 'docx',
          review_render_kind: 'docx_block',
          latest_draft_snapshot_id: document.latestDocId,
          draft_artifact_path: draftArtifactPath,
          working_artifact_path: workingArtifactPath,
          committed_artifact_path: committedArtifactPath,
          source_version: sourceVersion,
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
          changes: reviewChanges,
          commit_attempts: []
        })
      } finally {
        try {
          await fs.rm(sourceArtifactPath, { force: true })
        } catch {
          // Ignore source artifact cleanup failures for test/runtime stability.
        }
      }
    }

    this.runDrafts.delete(input.runId)
    return details
  }

  private buildReviewChanges(input: {
    reviewId: string
    session: DocxReplaySession
    now: number
  }): FileReviewChange[] {
    const revisions = [...input.session.revisionByDocId.values()]
      .filter(
        (revision) =>
          revision.revisionRef !== 'v1' &&
          (revision.ops?.length || 0) > 0 &&
          (revision.changedBlocks?.length || 0) > 0
      )
      .sort((left, right) => left.createdAt - right.createdAt)

    let orderIndex = 1
    return revisions.flatMap((revision) =>
      (revision.changedBlocks || []).map((change, changeIndex) => {
        const op = revision.ops?.[changeIndex] || revision.ops?.[0]
        return {
          id: `${input.reviewId}-${revision.revisionRef}-${String(orderIndex)}`,
          review_id: input.reviewId,
          order_index: orderIndex++,
          change_kind: op ? getDocxChangeKind(op) : 'block',
          title: op ? buildDocxChangeTitle(op, change) : revision.summary || '文档修改',
          summary: op ? buildDocxChangeSummary(op, change) : revision.summary || '',
          decision: 'pending',
          before_text: change.beforeText,
          after_text: change.afterText,
          locator: buildDocxChangeLocator(change),
          metadata: {
            revision_ref: revision.revisionRef,
            group_id: revision.revisionRef,
            ...(op ? { docx_op_json: JSON.stringify(op) } : {}),
            ...(revision.createdBlocks
              ? { created_blocks_json: JSON.stringify(revision.createdBlocks) }
              : {})
          },
          created_at: input.now,
          updated_at: input.now
        }
      })
    )
  }
}
