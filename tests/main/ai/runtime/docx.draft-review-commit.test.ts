import { access, readFile, stat, utimes } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, test } from 'vitest'
import { DraftReviewService } from '../../../../src/main/services/ai/review/DraftReviewService'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { getDocxWorkerClient, releaseDocxRunSession } from '../../../../src/main/services/ai/tools/docx/worker/docxWorkerClient'
import type {
  DocxChangedBlock,
  DocxOp,
  DocxOutlineBlock
} from '../../../../src/main/services/ai/tools/docx/types'
import type {
  DraftChangeDecision,
  DraftCommitJob,
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewSummary,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse
} from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { createTestAiRunContext } from '../../../harness/main/contextFactory'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')

type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonRecord | JsonValue[]
type JsonRecord = {
  [key: string]: JsonValue
}

type OutlineParagraphBlock = Extract<DocxOutlineBlock, { type: 'paragraph' }>

const asRecord = (value: JsonValue | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asString = (value: JsonValue | undefined): string => String(value || '')

const asBoolean = (value: JsonValue | undefined): boolean => value === true

const asRecordArray = (value: JsonValue | undefined): JsonRecord[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const hashFile = async (filePath: string): Promise<string> => {
  const buffer = await readFile(filePath)
  return createHash('sha256').update(buffer).digest('hex')
}

const pathExists = async (filePath: string | undefined): Promise<boolean> => {
  if (!filePath) return false
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const toOutlineParagraphBlocks = (value: JsonValue | undefined): OutlineParagraphBlock[] => {
  return asRecordArray(value)
    .map((item) => ({
      blockId: asString(item.blockId),
      type: asString(item.type),
      style: asString(item.style),
      text: asString(item.text)
    }))
    .filter((item): item is OutlineParagraphBlock => item.type === 'paragraph' && item.blockId.length > 0)
}

const createDocxTools = (input: {
  runId: string
  taskId: string
  workspaceRoot: string
  sessionId: string
  eventCollector: { add: (event: Parameters<ReturnType<typeof createTestAiRunContext>['sendEvent']>[0]) => void }
  reviewService: DraftReviewService
}) => {
  const ctx = createTestAiRunContext({
    runId: input.runId,
    sessionId: input.sessionId,
    workspaceRootPath: input.workspaceRoot,
    eventCollector: input.eventCollector,
    trackDocxOpen: ({ docId, sourcePath }) => {
      input.reviewService.registerDocxOpen({
        runId: input.runId,
        docId,
        sourcePath
      })
    },
    trackDocxChanges: ({ previousDocId, nextDocId, op, changedBlocks }) => {
      input.reviewService.registerDocxChanges({
        runId: input.runId,
        previousDocId,
        nextDocId,
        op,
        changedBlocks
      })
    },
    trackDocxPreview: ({ docId, previewPath }) => {
      input.reviewService.registerDocxPreview({
        runId: input.runId,
        docId,
        previewPath
      })
    }
  })

  const built = buildDocxCapabilityTools({
    ctx,
    runId: input.runId,
    taskId: input.taskId,
    workspaceRootPath: input.workspaceRoot,
    safePreviewChars: 1400,
    emitActivity: (activity) => {
      input.eventCollector.add({
        type: 'activity',
        runId: input.runId,
        taskId: input.taskId,
        activityId: `activity-${Date.now().toString(36)}`,
        actionType: activity.actionType,
        status: activity.status,
        summary: activity.summary,
        createdAt: Date.now()
      })
    }
  })

  return {
    ctx,
    tools: built.tools
  }
}

const searchDocxLiteral = async (input: {
  runId: string
  sourcePath: string
  query: string
}): Promise<JsonRecord> => {
  const client = getDocxWorkerClient()
  try {
    const openResponse = await client.call({
      runId: input.runId,
      action: 'open',
      payload: {
        sourcePath: input.sourcePath
      }
    })
    if (!openResponse.ok || openResponse.payload.action !== 'open') {
      throw new Error(openResponse.ok ? 'worker protocol mismatch (verify open)' : openResponse.error)
    }
    const searchResponse = await client.call({
      runId: input.runId,
      action: 'search',
      payload: {
        docId: openResponse.payload.docId,
        query: input.query,
        mode: 'literal',
        scopeBlockIds: []
      }
    })
    if (!searchResponse.ok || searchResponse.payload.action !== 'search') {
      throw new Error(searchResponse.ok ? 'worker protocol mismatch (verify search)' : searchResponse.error)
    }
    return {
      ok: true,
      matches: searchResponse.payload.matches.map((match) => ({
        blockId: match.blockId,
        text: match.text
      }))
    }
  } finally {
    await releaseDocxRunSession(input.runId)
  }
}

class InMemoryDraftReviewStore {
  private readonly details = new Map<string, DraftReviewDetail>()

  private cloneDetail(detail: DraftReviewDetail): DraftReviewDetail {
    return structuredClone(detail)
  }

  private ensureDetail(reviewId: string): DraftReviewDetail {
    const detail = this.details.get(reviewId)
    if (!detail) {
      const emptyDetail: DraftReviewDetail = {
        review: {
          id: reviewId,
          session_id: '',
          run_id: '',
          status: 'review_pending',
          title: '',
          document_count: 0,
          change_count: 0,
          pending_change_count: 0,
          accepted_change_count: 0,
          rejected_change_count: 0,
          created_at: 0,
          updated_at: 0
        },
        documents: [],
        changes: [],
        commit_jobs: []
      }
      this.details.set(reviewId, emptyDetail)
      return emptyDetail
    }
    return detail
  }

  public async saveReview(review: DraftReviewSummary): Promise<void> {
    const detail = this.ensureDetail(review.id)
    detail.review = structuredClone(review)
  }

  public async listReviews(filters?: ListDraftReviewsRequest): Promise<ListDraftReviewsResponse> {
    const items = [...this.details.values()]
      .map((detail) => structuredClone(detail.review))
      .filter((review) => {
        if (filters?.sessionId && review.session_id !== filters.sessionId) return false
        if (filters?.status && review.status !== filters.status) return false
        return true
      })
      .sort((left, right) => right.updated_at - left.updated_at)
    return {
      items,
      total: items.length
    }
  }

  public async getReview(reviewId: string): Promise<DraftReviewSummary | null> {
    const detail = this.details.get(reviewId)
    return detail ? structuredClone(detail.review) : null
  }

  public async replaceDocuments(reviewId: string, documents: DraftReviewDocument[]): Promise<void> {
    const detail = this.ensureDetail(reviewId)
    detail.documents = structuredClone(documents)
  }

  public async listDocuments(reviewId: string): Promise<DraftReviewDocument[]> {
    const detail = this.details.get(reviewId)
    return detail ? structuredClone(detail.documents) : []
  }

  public async replaceChanges(reviewId: string, changes: DraftReviewChange[]): Promise<void> {
    const detail = this.ensureDetail(reviewId)
    detail.changes = structuredClone(changes)
  }

  public async listChanges(reviewId: string): Promise<DraftReviewChange[]> {
    const detail = this.details.get(reviewId)
    return detail ? structuredClone(detail.changes) : []
  }

  public async updateChangeDecision(
    reviewId: string,
    changeId: string,
    decision: DraftChangeDecision
  ): Promise<DraftReviewChange | null> {
    const detail = this.details.get(reviewId)
    if (!detail) return null
    const change = detail.changes.find((item) => item.id === changeId)
    if (!change) return null
    change.decision = decision
    change.updated_at = Date.now()
    return structuredClone(change)
  }

  public async replaceCommitJobs(reviewId: string, jobs: DraftCommitJob[]): Promise<void> {
    const detail = this.ensureDetail(reviewId)
    detail.commit_jobs = structuredClone(jobs)
  }

  public async listCommitJobs(reviewId: string): Promise<DraftCommitJob[]> {
    const detail = this.details.get(reviewId)
    return detail ? structuredClone(detail.commit_jobs) : []
  }

  public async saveReviewDetail(detail: DraftReviewDetail): Promise<void> {
    this.details.set(detail.review.id, this.cloneDetail(detail))
  }

  public async getReviewDetail(reviewId: string): Promise<DraftReviewDetail | null> {
    const detail = this.details.get(reviewId)
    return detail ? this.cloneDetail(detail) : null
  }

  public async deleteReview(reviewId: string): Promise<void> {
    this.details.delete(reviewId)
  }
}

class InMemoryDocumentsStore {
  public async getDocumentByFilePath(): Promise<null> {
    return null
  }
}

describe('runtime/docx draft review commit', () => {
  test('latest draft snapshot is readable during run and finalize produces a persisted review', async () => {
    await runRuntimeCase({
      caseId: 'docx-draft-review-ready',
      description:
        '验证 docx 编辑运行在不落盘源文件的前提下，后续读取默认基于最新草稿快照，并在运行结束时统一生成可恢复的草稿审阅集合。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'draft-review', 'latest-snapshot', 'review-ready'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const finalizeResult = result.reviewDetail ? 'ok' : 'failed'
        return {
          status: finalizeResult === 'ok' ? 'completed' : 'failed',
          resultCode: finalizeResult,
          summary: `review=${finalizeResult}, searchMatches=${String(result.searchMatchCount)}`
        }
      },
      execute: async (runtime) => {
        const reviewService = new DraftReviewService(
          new InMemoryDraftReviewStore() as never,
          new InMemoryDocumentsStore() as never
        )
        reviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'runtime-review-session',
          inputText: '更新文档并生成待审阅草稿'
        })

        const sourcePath = path.join(runtime.workspaceRoot, 'input.docx')
        const sourceChecksumBefore = await hashFile(sourcePath)
        const { tools } = createDocxTools({
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRoot: runtime.workspaceRoot,
          sessionId: 'runtime-review-session',
          eventCollector: runtime.eventCollector,
          reviewService
        })

        const openTool = getToolByName(tools, 'docx_open')
        const applyTool = getToolByName(tools, 'docx_apply_ops')
        const searchTool = getToolByName(tools, 'docx_search')
        const previewTool = getToolByName(tools, 'docx_render_preview')

        try {
          const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
          const applyResult = asRecord(
            (await applyTool.invoke({
              ops: [
                {
                  type: 'replace_text',
                  query: 'Hello',
                  replace: 'Draft Snapshot Ready',
                  replaceAll: true
                } satisfies DocxOp
              ]
            })) as JsonValue
          )
          const searchResult = asRecord(
            (await searchTool.invoke({
              query: 'Draft Snapshot Ready',
              mode: 'literal'
            })) as JsonValue
          )
          const previewResult = asRecord(
            (await previewTool.invoke({
              format: 'html'
            })) as JsonValue
          )

          const reviewDetail = await reviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const sourceChecksumAfter = await hashFile(sourcePath)
          const listed = await reviewService.listReviews({ sessionId: 'runtime-review-session' })
          const stored = reviewDetail
            ? await reviewService.getReview({ reviewId: reviewDetail.review.id })
            : { review: undefined, error: 'review missing' }

          return {
            openResult,
            applyResult,
            searchResult,
            previewResult,
            reviewDetail,
            listed,
            stored,
            searchMatchCount: asRecordArray(searchResult.matches).length,
            sourceChecksumBefore,
            sourceChecksumAfter,
            previewExists: await pathExists(asString(previewResult.previewPath)),
            draftExists: await pathExists(reviewDetail?.documents[0]?.draft_artifact_path)
          }
        } finally {
          await releaseDocxRunSession(runtime.runId)
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.open-ok',
          pass: asBoolean(result.openResult.ok),
          details: JSON.stringify(result.openResult)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.apply-produced-change',
          pass:
            asBoolean(result.applyResult.ok) &&
            asRecordArray(result.applyResult.changedBlocks).length > 0,
          details: JSON.stringify(result.applyResult)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.search-defaults-to-latest-draft',
          pass:
            asBoolean(result.searchResult.ok) &&
            asRecordArray(result.searchResult.matches).length > 0,
          details: JSON.stringify(result.searchResult)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.preview-registered',
          pass:
            asBoolean(result.previewResult.ok) &&
            result.previewExists === true &&
            result.reviewDetail?.documents[0]?.preview_artifact_path ===
              asString(result.previewResult.previewPath),
          details: JSON.stringify({
            previewResult: result.previewResult,
            reviewDetail: result.reviewDetail
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.finalize-created-review',
          pass:
            Boolean(result.reviewDetail) &&
            result.reviewDetail?.review.status === 'review_pending' &&
            result.reviewDetail?.review.change_count === result.reviewDetail?.changes.length &&
            result.draftExists === true,
          details: JSON.stringify(result.reviewDetail)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.review-persisted',
          pass:
            result.listed.total === 1 &&
            result.stored.review?.review.id === result.reviewDetail?.review.id,
          details: JSON.stringify({
            listed: result.listed,
            stored: result.stored
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.review-ready.source-unchanged-before-commit',
          pass: result.sourceChecksumBefore === result.sourceChecksumAfter,
          details: `${result.sourceChecksumBefore} vs ${result.sourceChecksumAfter}`
        })
      }
    })
  })

  test('partial accept commits only accepted changes and archives draft artifacts after success', async () => {
    await runRuntimeCase({
      caseId: 'docx-draft-review-partial-commit',
      description:
        '验证草稿审阅支持部分接受后提交，真实文件只写入被接受的修改，并在提交完成后清理草稿与预览产物。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'draft-review', 'partial-accept', 'commit-cleanup'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => ({
        status: result.commitResponse.success ? 'completed' : 'failed',
        resultCode: result.commitResponse.success ? 'ok' : 'failed',
        summary: `commit=${String(result.commitResponse.success)}, acceptedMatches=${String(result.acceptedMatchCount)}`
      }),
      execute: async (runtime) => {
        const reviewService = new DraftReviewService(
          new InMemoryDraftReviewStore() as never,
          new InMemoryDocumentsStore() as never
        )
        reviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'runtime-commit-session',
          inputText: '部分接受后提交草稿'
        })

        const sourcePath = path.join(runtime.workspaceRoot, 'input.docx')
        const { tools } = createDocxTools({
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRoot: runtime.workspaceRoot,
          sessionId: 'runtime-commit-session',
          eventCollector: runtime.eventCollector,
          reviewService
        })

        const openTool = getToolByName(tools, 'docx_open')
        const outlineTool = getToolByName(tools, 'docx_outline')
        const applyTool = getToolByName(tools, 'docx_apply_ops')
        const previewTool = getToolByName(tools, 'docx_render_preview')

        const verifyBeforeCommitRunId = `${runtime.runId}-verify-before`
        const verifyAfterCommitRunId = `${runtime.runId}-verify-after`

        try {
          const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
          const outlineResult = asRecord(
            (await outlineTool.invoke({
              maxBlocks: 80,
              includeTables: true,
              includeCells: true
            })) as JsonValue
          )
          const firstParagraphId = toOutlineParagraphBlocks(outlineResult.blocks)[0]?.blockId || ''
          if (!firstParagraphId) {
            throw new Error('first paragraph block is missing')
          }

          const applyResult = asRecord(
            (await applyTool.invoke({
              ops: [
                {
                  type: 'replace_block',
                  blockId: firstParagraphId,
                  content: {
                    kind: 'paragraph',
                    runs: [{ text: 'Accepted paragraph change' }]
                  }
                } satisfies DocxOp,
                {
                  type: 'insert_after',
                  anchorBlockId: firstParagraphId,
                  content: [
                    {
                      kind: 'paragraph',
                      runs: [{ text: 'Rejected extra paragraph' }]
                    }
                  ]
                } satisfies DocxOp
              ]
            })) as JsonValue
          )

          const previewResult = asRecord(
            (await previewTool.invoke({
              format: 'html'
            })) as JsonValue
          )

          const reviewDetail = await reviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          if (!reviewDetail) {
            throw new Error('review detail missing after finalize')
          }

          const sortedChanges = reviewDetail.changes
            .slice()
            .sort((left, right) => left.order_index - right.order_index)
          if (sortedChanges.length < 2) {
            throw new Error(`expected at least 2 review changes, got ${String(sortedChanges.length)}`)
          }

          const beforeAcceptedSearch = await searchDocxLiteral({
            runId: verifyBeforeCommitRunId,
            sourcePath,
            query: 'Accepted paragraph change'
          })
          const beforeRejectedSearch = await searchDocxLiteral({
            runId: `${verifyBeforeCommitRunId}-rejected`,
            sourcePath,
            query: 'Rejected extra paragraph'
          })

          await reviewService.setChangeDecision({
            reviewId: reviewDetail.review.id,
            changeId: sortedChanges[0].id,
            decision: 'accepted'
          })
          await reviewService.setChangeDecision({
            reviewId: reviewDetail.review.id,
            changeId: sortedChanges[1].id,
            decision: 'rejected'
          })

          const validation = await reviewService.validateCommit({
            reviewId: reviewDetail.review.id
          })
          const commitResponse = await reviewService.commitReview({
            reviewId: reviewDetail.review.id,
            overwrite: true
          })
          const storedAfterCommit = await reviewService.getReview({
            reviewId: reviewDetail.review.id
          })
          const afterAcceptedSearch = await searchDocxLiteral({
            runId: verifyAfterCommitRunId,
            sourcePath,
            query: 'Accepted paragraph change'
          })
          const afterRejectedSearch = await searchDocxLiteral({
            runId: `${verifyAfterCommitRunId}-rejected`,
            sourcePath,
            query: 'Rejected extra paragraph'
          })

          const documentAfterCommit = storedAfterCommit.review?.documents[0]
          return {
            openResult,
            outlineResult,
            applyResult,
            previewResult,
            reviewDetail,
            validation,
            commitResponse,
            storedAfterCommit,
            beforeAcceptedMatchCount: asRecordArray(beforeAcceptedSearch.matches).length,
            beforeRejectedMatchCount: asRecordArray(beforeRejectedSearch.matches).length,
            acceptedMatchCount: asRecordArray(afterAcceptedSearch.matches).length,
            rejectedMatchCount: asRecordArray(afterRejectedSearch.matches).length,
            previewExistsAfterCommit: await pathExists(asString(previewResult.previewPath)),
            draftExistsAfterCommit: await pathExists(reviewDetail.documents[0]?.draft_artifact_path),
            documentAfterCommit
          }
        } finally {
          await releaseDocxRunSession(runtime.runId)
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'docx.partial-commit.validation-ready',
          pass: result.validation.ready === true,
          details: JSON.stringify(result.validation)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.partial-commit.source-unchanged-before-commit',
          pass: result.beforeAcceptedMatchCount === 0 && result.beforeRejectedMatchCount === 0,
          details: JSON.stringify({
            beforeAcceptedMatchCount: result.beforeAcceptedMatchCount,
            beforeRejectedMatchCount: result.beforeRejectedMatchCount
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.partial-commit.successful-job',
          pass:
            result.commitResponse.success === true &&
            result.commitResponse.job?.status === 'completed' &&
            (result.commitResponse.job?.results.length || 0) > 0,
          details: JSON.stringify(result.commitResponse)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.partial-commit.accepted-only-written-back',
          pass: result.acceptedMatchCount > 0 && result.rejectedMatchCount === 0,
          details: JSON.stringify({
            acceptedMatchCount: result.acceptedMatchCount,
            rejectedMatchCount: result.rejectedMatchCount
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.partial-commit.review-archived-after-success',
          pass:
            result.storedAfterCommit.review?.review.status === 'committed' &&
            result.documentAfterCommit?.draft_artifact_path === undefined &&
            result.documentAfterCommit?.preview_artifact_path === undefined,
          details: JSON.stringify(result.storedAfterCommit)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.partial-commit.review-artifacts-cleaned',
          pass: result.previewExistsAfterCommit === false && result.draftExistsAfterCommit === false,
          details: JSON.stringify({
            previewExistsAfterCommit: result.previewExistsAfterCommit,
            draftExistsAfterCommit: result.draftExistsAfterCommit
          })
        })
      }
    })
  })

  test('source freshness conflicts block commit and record conflicted commit status', async () => {
    await runRuntimeCase({
      caseId: 'docx-draft-review-conflict',
      description:
        '验证草稿审阅在源文件版本变化后会阻止提交，并把尝试中的提交记录为冲突状态。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'draft-review', 'conflict', 'freshness-check'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => ({
        status:
          result.validation.ready === false && result.commitResponse.success === false
            ? 'completed'
            : 'failed',
        resultCode:
          result.commitResponse.job?.status === 'conflicted' ? 'conflicted' : 'failed',
        summary: `issues=${String(result.validation.issues.length)}, job=${result.commitResponse.job?.status || 'none'}`
      }),
      execute: async (runtime) => {
        const reviewService = new DraftReviewService(
          new InMemoryDraftReviewStore() as never,
          new InMemoryDocumentsStore() as never
        )
        reviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'runtime-conflict-session',
          inputText: '提交前检测源文件冲突'
        })

        const sourcePath = path.join(runtime.workspaceRoot, 'input.docx')
        const sourceStat = await stat(sourcePath)
        const { tools } = createDocxTools({
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRoot: runtime.workspaceRoot,
          sessionId: 'runtime-conflict-session',
          eventCollector: runtime.eventCollector,
          reviewService
        })

        const openTool = getToolByName(tools, 'docx_open')
        const applyTool = getToolByName(tools, 'docx_apply_ops')

        try {
          await openTool.invoke({ sourcePath: 'input.docx' })
          await applyTool.invoke({
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Conflict Pending Change',
                replaceAll: true
              } satisfies DocxOp
            ]
          })

          const reviewDetail = await reviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          if (!reviewDetail) {
            throw new Error('review detail missing after finalize')
          }
          await reviewService.setChangeDecision({
            reviewId: reviewDetail.review.id,
            changeId: reviewDetail.changes[0]?.id || '',
            decision: 'accepted'
          })

          const nextTime = new Date(sourceStat.mtimeMs + 120_000)
          await utimes(sourcePath, nextTime, nextTime)

          const validation = await reviewService.validateCommit({
            reviewId: reviewDetail.review.id
          })
          const commitResponse = await reviewService.commitReview({
            reviewId: reviewDetail.review.id,
            overwrite: true
          })
          const storedAfterConflict = await reviewService.getReview({
            reviewId: reviewDetail.review.id
          })

          return {
            reviewDetail,
            validation,
            commitResponse,
            storedAfterConflict
          }
        } finally {
          await releaseDocxRunSession(runtime.runId)
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'docx.conflict.validation-blocks-commit',
          pass:
            result.validation.ready === false &&
            result.validation.issues.some((issue) => issue.code === 'source_changed'),
          details: JSON.stringify(result.validation)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.conflict.commit-response-marked-conflicted',
          pass:
            result.commitResponse.success === false &&
            result.commitResponse.job?.status === 'conflicted',
          details: JSON.stringify(result.commitResponse)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.conflict.review-status-updated',
          pass: result.storedAfterConflict.review?.review.status === 'conflicted',
          details: JSON.stringify(result.storedAfterConflict)
        })
      }
    })
  })
})
