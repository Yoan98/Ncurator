import fs from 'node:fs/promises'
import path from 'node:path'
import { test, vi } from 'vitest'
import type {
  DocumentRecord,
  DraftChangeDecision,
  DraftCommitJob,
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewSummary
} from '../../../../../src/shared/types'
import type { DocumentsStore } from '../../../../../src/main/services/storage/domains/DocumentsStore'
import type { DraftReviewStore } from '../../../../../src/main/services/storage/domains/DraftReviewStore'
import { DraftReviewService } from '../../../../../src/main/services/ai/human/tools/docx/review/DraftReviewService'
import { DraftReviewStateService } from '../../../../../src/main/services/ai/human/tools/docx/review/DraftReviewStateService'
import * as docxWorkerClientModule from '../../../../../src/main/services/ai/human/tools/docx/worker/docxWorkerClient'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

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
    async getReviewDetail(reviewId: string): Promise<DraftReviewDetail | null> {
      const detail = detailById.get(reviewId)
      return detail ? cloneDetail(detail) : null
    },
    async updateChangeDecision(
      reviewId: string,
      changeId: string,
      decision: DraftChangeDecision
    ): Promise<DraftReviewChange | null> {
      const detail = detailById.get(reviewId)
      if (!detail) return null

      const currentChange = detail.changes.find((change) => change.id === changeId)
      if (!currentChange) return null

      const nextChange: DraftReviewChange = {
        ...currentChange,
        decision,
        updated_at: Date.now()
      }
      detailById.set(reviewId, {
        ...detail,
        changes: detail.changes.map((change) => (change.id === changeId ? nextChange : change))
      })
      return { ...nextChange }
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
    }
  } as unknown as DraftReviewStore
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
  }) as unknown as DocumentsStore

test('draft-review-service', async () => {
  await runBackendCase({
    caseId: 'draft-review-service',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['docx'],
    description:
      'draft review facade should preserve finalize, review-state rebuild, validate, and commit behavior after splitting tracker/state/commit services.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const sourcePath = path.join(runtime.workspaceRoot, 'review-source.docx')
      const previewPath = path.join(runtime.workspaceRoot, 'preview.docx')
      await fs.writeFile(sourcePath, Buffer.from('source document'))
      await fs.writeFile(previewPath, Buffer.from('preview document'))

      const draftReviewStore = createDraftReviewStoreStub()
      const documentsStore = createDocumentsStoreStub(sourcePath)
      const service = new DraftReviewService(draftReviewStore, documentsStore)
      const stateService = new DraftReviewStateService(draftReviewStore)
      const workerCalls: Array<{ action: string; outPath?: string; runId: string }> = []

      const getClientSpy = vi
        .spyOn(docxWorkerClientModule, 'getDocxWorkerClient')
        .mockReturnValue({
          call: async (request) => {
            workerCalls.push({
              action: request.action,
              outPath:
                'payload' in request && typeof request.payload === 'object'
                  ? ('outPath' in request.payload ? request.payload.outPath : undefined)
                  : undefined,
              runId: request.runId
            })

            if (request.action === 'open') {
              return {
                requestId: 'open-request',
                ok: true,
                payload: {
                  action: 'open',
                  docId: 'commit-doc-1',
                  meta: {
                    title: '',
                    creator: '',
                    lastModifiedBy: '',
                    description: '',
                    defaultFont: 'Calibri'
                  },
                  stats: {
                    blockCount: 1,
                    paragraphCount: 1,
                    tableCount: 0,
                    imageCount: 0,
                    charCount: 12
                  }
                }
              } as const
            }

            if (request.action === 'apply_ops') {
              return {
                requestId: 'apply-request',
                ok: true,
                payload: {
                  action: 'apply_ops',
                  newDocId: 'commit-doc-2',
                  changedBlocks: [],
                  warnings: []
                }
              } as const
            }

            if (request.action === 'save') {
              const outPath = request.payload.outPath
              await fs.mkdir(path.dirname(outPath), { recursive: true })
              await fs.writeFile(outPath, Buffer.from(`saved:${path.basename(outPath)}`))
              return {
                requestId: 'save-request',
                ok: true,
                payload: {
                  action: 'save',
                  outPath,
                  checksum: `checksum:${path.basename(outPath)}`,
                  byteSize: 16
                }
              } as const
            }

            throw new Error(`unexpected worker action: ${request.action}`)
          }
        })
      const releaseSpy = vi
        .spyOn(docxWorkerClientModule, 'releaseDocxRunSession')
        .mockResolvedValue(undefined)

      try {
        service.beginRun({
          runId: runtime.runId,
          sessionId: 'draft-review-session',
          inputText: '更新文档中的关键措辞'
        })
        service.registerDocxOpen({
          runId: runtime.runId,
          docId: 'doc-1',
          sourcePath
        })
        service.registerDocxChanges({
          runId: runtime.runId,
          previousDocId: 'doc-1',
          nextDocId: 'doc-2',
          op: {
            type: 'replace_text',
            query: 'source',
            replace: 'updated'
          },
          changedBlocks: [
            {
              action: 'replace_text',
              blockId: 'paragraph-1',
              beforeText: 'source document',
              afterText: 'updated document'
            }
          ]
        })
        service.registerDocxPreview({
          runId: runtime.runId,
          docId: 'doc-2',
          previewPath
        })

        const detail = await service.finalizeRunReview({
          runId: runtime.runId,
          workspaceRootPath: runtime.workspaceRoot
        })
        if (!detail) {
          throw new Error('expected draft review detail to be created')
        }

        const decisionResult = await service.setChangeDecision({
          reviewId: detail.review.id,
          changeId: detail.changes[0]?.id || '',
          decision: 'accepted'
        })
        const rebuiltDetail = await stateService.rebuildReviewState(detail.review.id)
        const validation = await service.validateCommit({ reviewId: detail.review.id })
        const commit = await service.commitReview({
          reviewId: detail.review.id,
          overwrite: true
        })
        const committedReview = await service.getReview({ reviewId: detail.review.id })

        return {
          detail,
          decisionResult,
          rebuiltDetail,
          validation,
          commit,
          committedReview,
          workerCalls,
          previewExistsAfterCommit: await fs
            .access(previewPath)
            .then(() => true)
            .catch(() => false),
          draftExistsAfterCommit: detail.documents[0]?.draft_artifact_path
            ? await fs
                .access(detail.documents[0].draft_artifact_path)
                .then(() => true)
                .catch(() => false)
            : false,
          sourceContentsAfterCommit: await fs.readFile(sourcePath, 'utf8'),
          releaseCalls: releaseSpy.mock.calls
        }
      } finally {
        getClientSpy.mockRestore()
        releaseSpy.mockRestore()
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.detail.review.status === 'review_pending' &&
          result.detail.documents.length === 1 &&
          result.detail.changes.length === 1 &&
          Boolean(result.detail.documents[0]?.draft_artifact_path),
        {
          name: 'draft-review-finalize',
          message:
            'finalizeRunReview should still build one persisted review with document, change, and saved draft artifact metadata after tracker extraction',
          data: result.detail
        }
      )

      runtime.assertThat(
        result.decisionResult.success &&
          result.decisionResult.review?.status === 'commit_ready' &&
          result.decisionResult.document?.accepted_change_count === 1,
        {
          name: 'draft-review-rebuild-state',
          message:
            'setChangeDecision should still rebuild review/document counters through the extracted review state service',
          data: {
            decisionResult: result.decisionResult,
            rebuiltDetail: result.rebuiltDetail
          }
        }
      )

      runtime.assertThat(
        result.rebuiltDetail.review.status === 'commit_ready' &&
          result.rebuiltDetail.review.pending_change_count === 0 &&
          result.rebuiltDetail.review.accepted_change_count === 1,
        {
          name: 'draft-review-state-service',
          message:
            'DraftReviewStateService.rebuildReviewState should keep review counters and status consistent after the service split',
          data: result.rebuiltDetail
        }
      )

      runtime.assertThat(result.validation.ready, {
        name: 'draft-review-validate',
        message:
          'validateCommit should still report ready once all changes are resolved and the source file remains fresh',
        data: result.validation
      })

      runtime.assertThat(
        result.commit.success &&
          result.commit.job?.status === 'completed' &&
          result.committedReview.review?.review.status === 'committed',
        {
          name: 'draft-review-commit',
          message:
            'commitReview should still finish successfully and archive the review detail through the extracted commit service',
          data: {
            commit: result.commit,
            committedReview: result.committedReview
          }
        }
      )

      runtime.assertThat(
        result.previewExistsAfterCommit === false &&
          result.draftExistsAfterCommit === false &&
          result.sourceContentsAfterCommit.includes('saved:review-source.docx'),
        {
          name: 'draft-review-artifact-cleanup',
          message:
            'commitReview should still clean preview/draft artifacts and write the committed content back to the source path',
          data: {
            previewExistsAfterCommit: result.previewExistsAfterCommit,
            draftExistsAfterCommit: result.draftExistsAfterCommit,
            sourceContentsAfterCommit: result.sourceContentsAfterCommit
          }
        }
      )

      runtime.assertThat(
        result.workerCalls.some((call) => call.action === 'save' && call.runId === runtime.runId) &&
          result.workerCalls.some(
            (call) => call.action === 'open' && call.runId.startsWith('draft-commit-')
          ) &&
          result.workerCalls.some(
            (call) => call.action === 'apply_ops' && call.runId.startsWith('draft-commit-')
          ) &&
          result.releaseCalls.length === 1,
        {
          name: 'draft-review-worker-flow',
          message:
            'finalize and commit paths should still exercise save/open/apply_ops/save worker flow and release the commit run session',
          data: {
            workerCalls: result.workerCalls,
            releaseCalls: result.releaseCalls
          }
        }
      )
    }
  })
})
