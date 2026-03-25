import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { test } from 'vitest'
import type {
  DocumentRecord,
  DraftCommitJob,
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewSummary
} from '../../../../../src/shared/types'
import type { DocumentsStore } from '../../../../../src/main/services/storage/domains/DocumentsStore'
import type { DraftReviewStore } from '../../../../../src/main/services/storage/domains/DraftReviewStore'
import { DraftReviewService } from '../../../../../src/main/services/ai/human/tools/docx/review/DraftReviewService'
import {
  getDocxWorkerClient,
  releaseDocxRunSession
} from '../../../../../src/main/services/ai/human/tools/docx/worker/docxWorkerClient'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const FIXTURE_PATH = path.resolve(process.cwd(), 'tests/fixtures/ai/docx/sample-edit.docx')

const cloneDetail = (detail: DraftReviewDetail): DraftReviewDetail => ({
  review: { ...detail.review },
  documents: detail.documents.map((document) => ({
    ...document,
    source_version: { ...document.source_version }
  })),
  changes: detail.changes.map((change) => ({
    ...change,
    locator: { ...change.locator },
    metadata: change.metadata ? { ...change.metadata } : undefined
  })),
  commit_jobs: detail.commit_jobs.map((job) => ({
    ...job,
    results: job.results.map((result) => ({ ...result }))
  }))
})

const createDraftReviewStoreStub = (): DraftReviewStore => {
  const detailById = new Map<string, DraftReviewDetail>()

  const ensureExisting = (reviewId: string): DraftReviewDetail => {
    const detail = detailById.get(reviewId)
    if (!detail) throw new Error(`missing review detail: ${reviewId}`)
    return detail
  }

  return {
    async saveReview(review: DraftReviewSummary): Promise<void> {
      const existing = detailById.get(review.id)
      detailById.set(
        review.id,
        existing
          ? {
              ...existing,
              review: { ...review }
            }
          : {
              review: { ...review },
              documents: [],
              changes: [],
              commit_jobs: []
            }
      )
    },
    async listReviews(): Promise<{ items: DraftReviewSummary[]; total: number }> {
      const items = [...detailById.values()].map((detail) => ({ ...detail.review }))
      return {
        items,
        total: items.length
      }
    },
    async getReview(reviewId: string): Promise<DraftReviewSummary | null> {
      return detailById.get(reviewId)?.review || null
    },
    async getReviewDetail(reviewId: string): Promise<DraftReviewDetail | null> {
      const detail = detailById.get(reviewId)
      return detail ? cloneDetail(detail) : null
    },
    async replaceDocuments(reviewId: string, documents: DraftReviewDocument[]): Promise<void> {
      const detail = ensureExisting(reviewId)
      detailById.set(reviewId, {
        ...detail,
        documents: documents.map((document) => ({
          ...document,
          source_version: { ...document.source_version }
        }))
      })
    },
    async listDocuments(reviewId: string): Promise<DraftReviewDocument[]> {
      return ensureExisting(reviewId).documents.map((document) => ({
        ...document,
        source_version: { ...document.source_version }
      }))
    },
    async replaceChanges(reviewId: string, changes: DraftReviewChange[]): Promise<void> {
      const detail = ensureExisting(reviewId)
      detailById.set(reviewId, {
        ...detail,
        changes: changes.map((change) => ({
          ...change,
          locator: { ...change.locator },
          metadata: change.metadata ? { ...change.metadata } : undefined
        }))
      })
    },
    async listChanges(reviewId: string): Promise<DraftReviewChange[]> {
      return ensureExisting(reviewId).changes.map((change) => ({
        ...change,
        locator: { ...change.locator },
        metadata: change.metadata ? { ...change.metadata } : undefined
      }))
    },
    async replaceCommitJobs(reviewId: string, jobs: DraftCommitJob[]): Promise<void> {
      const detail = ensureExisting(reviewId)
      detailById.set(reviewId, {
        ...detail,
        commit_jobs: jobs.map((job) => ({
          ...job,
          results: job.results.map((result) => ({ ...result }))
        }))
      })
    },
    async listCommitJobs(reviewId: string): Promise<DraftCommitJob[]> {
      return ensureExisting(reviewId).commit_jobs.map((job) => ({
        ...job,
        results: job.results.map((result) => ({ ...result }))
      }))
    },
    async saveReviewDetail(detail: DraftReviewDetail): Promise<void> {
      detailById.set(detail.review.id, cloneDetail(detail))
    },
    async deleteReview(reviewId: string): Promise<void> {
      detailById.delete(reviewId)
    },
    async listActiveReviewsBySourcePath(sourcePath: string): Promise<DraftReviewDetail[]> {
      return [...detailById.values()]
        .filter((detail) => detail.documents.some((document) => document.source_path === sourcePath))
        .map((detail) => cloneDetail(detail))
    }
  } as DraftReviewStore
}

const createDocumentsStoreStub = (sourcePath: string): DocumentsStore =>
  ({
    async getDocumentByFilePath(filePath: string): Promise<DocumentRecord | null> {
      if (path.resolve(filePath) !== path.resolve(sourcePath)) return null
      return {
        id: 'source-document',
        name: path.basename(sourcePath),
        source_type: 'file',
        file_path: sourcePath,
        created_at: Date.now(),
        import_status: 2
      }
    }
  }) as DocumentsStore

const extractDocxText = async (docxPath: string): Promise<string> => {
  const buffer = await fs.readFile(docxPath)
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')?.async('text')
  return xml || ''
}

test('draft-review-service', async () => {
  await runBackendCase({
    caseId: 'draft-review-service',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['docx'],
    description:
      'draft review service should generate confirm copy sessions, resolve active confirm drafts for continued editing, and normalize the confirm copy back into the source document on commit.',
    fixtures: [FIXTURE_PATH],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const sourcePath = path.join(runtime.workspaceRoot, 'review-source.docx')
      await fs.copyFile(FIXTURE_PATH, sourcePath)

      const draftReviewStore = createDraftReviewStoreStub()
      const documentsStore = createDocumentsStoreStub(sourcePath)
      const service = new DraftReviewService(draftReviewStore, documentsStore)
      const client = getDocxWorkerClient()

      try {
        service.beginRun({
          runId: runtime.runId,
          sessionId: 'draft-review-session',
          inputText: '把 Hello 改成 Hi'
        })

        const openResponse = await client.call({
          runId: runtime.runId,
          action: 'open',
          payload: { sourcePath }
        })
        if (!openResponse.ok || openResponse.payload.action !== 'open') {
          throw new Error(openResponse.ok ? 'open worker protocol mismatch' : openResponse.error)
        }
        service.registerDocxOpen({
          runId: runtime.runId,
          docId: openResponse.payload.docId,
          sourcePath
        })

        const applyResponse = await client.call({
          runId: runtime.runId,
          action: 'apply_ops',
          payload: {
            docId: openResponse.payload.docId,
            ops: [{ type: 'replace_text', query: 'Hello', replace: 'Hi' }]
          }
        })
        if (!applyResponse.ok || applyResponse.payload.action !== 'apply_ops') {
          throw new Error(
            applyResponse.ok ? 'apply worker protocol mismatch' : applyResponse.error
          )
        }
        service.registerDocxChanges({
          runId: runtime.runId,
          previousDocId: openResponse.payload.docId,
          nextDocId: applyResponse.payload.newDocId,
          op: { type: 'replace_text', query: 'Hello', replace: 'Hi' },
          changedBlocks: applyResponse.payload.changedBlocks
        })

        const details = await service.finalizeRunReview({
          runId: runtime.runId,
          workspaceRootPath: runtime.workspaceRoot
        })
        const detail = details[0]
        if (!detail) {
          throw new Error('expected confirm session detail to be created')
        }

        const validation = await service.validateCommit({ reviewId: detail.review.id })
        const resolvedOpenTarget = await service.resolveDocxOpenTarget(sourcePath)
        const resolvedOpenText = await extractDocxText(resolvedOpenTarget.openPath)
        const confirmCopyText = detail.documents[0]?.confirm_artifact_path
          ? await extractDocxText(detail.documents[0].confirm_artifact_path)
          : ''

        const commit = await service.commitReview({
          reviewId: detail.review.id,
          overwrite: true
        })
        const committedReview = await service.getReview({ reviewId: detail.review.id })
        const sourceTextAfterCommit = await extractDocxText(sourcePath)
        const confirmExistsAfterCommit = detail.documents[0]?.confirm_artifact_path
          ? await fs
              .access(detail.documents[0].confirm_artifact_path)
              .then(() => true)
              .catch(() => false)
          : false

        return {
          detail,
          validation,
          resolvedOpenTarget,
          resolvedOpenText,
          confirmCopyText,
          commit,
          committedReview,
          sourceTextAfterCommit,
          confirmExistsAfterCommit
        }
      } finally {
        await releaseDocxRunSession(runtime.runId)
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.detail.review.status === 'pending_confirm' &&
          result.detail.documents.length === 1 &&
          result.detail.changes.length === 1 &&
          Boolean(result.detail.documents[0]?.confirm_artifact_path) &&
          Boolean(result.detail.documents[0]?.manifest_artifact_path) &&
          Boolean(result.detail.documents[0]?.effective_draft_artifact_path),
        {
          name: 'confirm-session-finalize',
          message:
            'finalizeRunReview should generate a single confirm session with confirm copy, manifest, and effective draft artifacts.',
          data: result.detail
        }
      )

      runtime.assertThat(
        result.validation.ready &&
          result.confirmCopyText.includes('w:ins') &&
          result.confirmCopyText.includes('w:del'),
        {
          name: 'confirm-copy-markup',
          message:
            'validateCommit should succeed and the generated confirm copy should contain inserted/deleted OOXML markers.',
          data: {
            validation: result.validation,
            confirmCopyText: result.confirmCopyText
          }
        }
      )

      runtime.assertThat(
        result.resolvedOpenTarget.trackedSourcePath === result.detail.documents[0].source_path &&
          result.resolvedOpenText.includes('Hi from fixture') &&
          !result.resolvedOpenText.includes('w:ins') &&
          !result.resolvedOpenText.includes('w:del'),
        {
          name: 'confirm-open-normalize',
          message:
            'continued AI editing should resolve through the active confirm copy and read a normalized clean draft instead of the raw source file.',
          data: {
            resolvedOpenTarget: result.resolvedOpenTarget,
            resolvedOpenText: result.resolvedOpenText
          }
        }
      )

      runtime.assertThat(
        result.commit.success &&
          result.commit.job?.status === 'completed' &&
          result.committedReview.review?.review.status === 'committed',
        {
          name: 'confirm-commit',
          message:
            'commitReview should normalize the confirm copy, replace the source file, and mark the confirm session as committed.',
          data: {
            commit: result.commit,
            committedReview: result.committedReview
          }
        }
      )

      runtime.assertThat(
        result.sourceTextAfterCommit.includes('Hi from fixture') &&
          result.confirmExistsAfterCommit === false,
        {
          name: 'confirm-artifact-cleanup',
          message:
            'after commit the source document should contain the normalized content and the confirm artifacts should be cleaned up.',
          data: {
            sourceTextAfterCommit: result.sourceTextAfterCommit,
            confirmExistsAfterCommit: result.confirmExistsAfterCommit
          }
        }
      )
    }
  })
})
