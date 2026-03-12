import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CommitDraftReviewRequest,
  CommitDraftReviewResponse,
  DraftCommitJob,
  DraftCommitResultItem,
  DraftCommitValidationIssue,
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewStatus,
  DraftReviewSummary,
  DraftSourceVersion,
  GetDraftReviewRequest,
  GetDraftReviewResponse,
  JsonObject,
  ListDraftReviewsRequest,
  ListDraftReviewsResponse,
  SetDraftChangeDecisionRequest,
  SetDraftChangeDecisionResponse,
  ValidateDraftCommitRequest,
  ValidateDraftCommitResponse
} from '../../../../shared/types'
import type { DocumentsStore } from '../../storage/domains/DocumentsStore'
import type { DraftReviewStore } from '../../storage/domains/DraftReviewStore'
import type { DocxChangedBlock, DocxOp } from '../tools/docx/types'
import { getDocxWorkerClient, releaseDocxRunSession } from '../tools/docx/worker/docxWorkerClient'

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

const clipText = (text: string, maxChars: number): string => {
  const raw = String(text || '').trim()
  if (raw.length <= maxChars) return raw
  return `${raw.slice(0, maxChars).trim()}...`
}

const sanitizeFileName = (value: string): string => {
  const normalized = String(value || '').trim()
  const safe = normalized.replace(/[^\w.-]+/g, '-')
  return safe || 'document.docx'
}

const describeDocxOp = (op: DocxOp): string => {
  switch (op.type) {
    case 'replace_block':
      return '替换块'
    case 'insert_after':
      return '后插入块'
    case 'insert_before':
      return '前插入块'
    case 'delete_block':
      return '删除块'
    case 'update_table_cell':
      return '更新表格单元格'
    case 'replace_text':
      return '替换文本'
  }
}

const getDocxChangeKind = (op: DocxOp): DraftReviewChange['change_kind'] => {
  return op.type === 'update_table_cell' ? 'table_cell' : 'block'
}

const buildDocxChangeTitle = (op: DocxOp, change: DocxChangedBlock): string => {
  const preview = clipText(change.afterText || change.beforeText, 28)
  return preview ? `${describeDocxOp(op)}: ${preview}` : describeDocxOp(op)
}

const buildDocxChangeSummary = (op: DocxOp, change: DocxChangedBlock): string => {
  return `${describeDocxOp(op)} ${change.blockId}`
}

const buildDocxChangeLocator = (change: DocxChangedBlock): JsonObject => ({
  blockId: change.blockId,
  action: change.action
})

const toReviewStatus = (hasPending: boolean, previous?: DraftReviewStatus): DraftReviewStatus => {
  if (previous === 'committing' || previous === 'committed') return previous
  if (previous === 'conflicted' || previous === 'failed' || previous === 'cancelled') return previous
  return hasPending ? 'review_pending' : 'commit_ready'
}

const buildSourceVersion = async (sourcePath: string): Promise<DraftSourceVersion> => {
  const stat = await fs.stat(sourcePath)
  const buffer = await fs.readFile(sourcePath)
  return {
    mtime_ms: stat.mtimeMs,
    byte_size: stat.size,
    checksum: createHash('sha256').update(buffer).digest('hex')
  }
}

const isSourceVersionFresh = async (
  sourcePath: string,
  version: DraftSourceVersion
): Promise<boolean> => {
  try {
    const current = await buildSourceVersion(sourcePath)
    if (version.byte_size !== undefined && current.byte_size !== version.byte_size) return false
    if (version.mtime_ms !== undefined && current.mtime_ms !== version.mtime_ms) return false
    if (version.checksum && current.checksum !== version.checksum) return false
    if (version.content_hash && current.content_hash !== version.content_hash) return false
    return true
  } catch {
    return false
  }
}

const parseDocxOpFromMetadata = (metadata?: JsonObject): DocxOp | null => {
  if (!metadata) return null
  const raw = metadata.docx_op_json
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw) as DocxOp
  } catch {
    return null
  }
}

const getMetadataGroupId = (metadata?: JsonObject): string => {
  return typeof metadata?.group_id === 'string' ? metadata.group_id : ''
}

const collectArtifactPaths = (detail: DraftReviewDetail): string[] => {
  const unique = new Set<string>()
  detail.documents.forEach((document) => {
    if (document.preview_artifact_path) unique.add(document.preview_artifact_path)
    if (document.draft_artifact_path) unique.add(document.draft_artifact_path)
  })
  detail.changes.forEach((change) => {
    if (change.preview_artifact_path) unique.add(change.preview_artifact_path)
  })
  return [...unique]
}

const createArchivedCommittedDetail = (input: {
  detail: DraftReviewDetail
  completedJob: DraftCommitJob
  committedAt: number
}): DraftReviewDetail => {
  const updatedAt = input.committedAt
  return {
    review: {
      ...input.detail.review,
      status: 'committed',
      committed_at: input.committedAt,
      updated_at: updatedAt,
      last_error: undefined
    },
    documents: input.detail.documents.map((document) => ({
      ...document,
      preview_artifact_path: undefined,
      draft_artifact_path: undefined,
      updated_at: updatedAt
    })),
    changes: input.detail.changes.map((change) => ({
      ...change,
      preview_artifact_path: undefined,
      updated_at: updatedAt
    })),
    commit_jobs: [
      ...input.detail.commit_jobs.filter((job) => job.id !== input.completedJob.id),
      input.completedJob
    ]
  }
}

export class DraftReviewService {
  private readonly runDrafts = new Map<string, RunDraftState>()

  public constructor(
    private readonly draftReviewStore: DraftReviewStore,
    private readonly documentsStore: DocumentsStore
  ) {}

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
      const pendingChangeCount = document.changes.length
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
        pending_change_count: pendingChangeCount,
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

    const detail: DraftReviewDetail = {
      review,
      documents,
      changes,
      commit_jobs: []
    }
    await this.draftReviewStore.saveReviewDetail(detail)
    this.runDrafts.delete(input.runId)
    return detail
  }

  public async listReviews(
    request?: ListDraftReviewsRequest
  ): Promise<ListDraftReviewsResponse> {
    return await this.draftReviewStore.listReviews(request)
  }

  public async getReview(
    request: GetDraftReviewRequest
  ): Promise<GetDraftReviewResponse> {
    const review = await this.draftReviewStore.getReviewDetail(request.reviewId)
    return review ? { review } : { error: 'review not found' }
  }

  public async setChangeDecision(
    request: SetDraftChangeDecisionRequest
  ): Promise<SetDraftChangeDecisionResponse> {
    const review = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!review) return { success: false, error: 'review not found' }

    const updatedChange = await this.draftReviewStore.updateChangeDecision(
      request.reviewId,
      request.changeId,
      request.decision
    )
    if (!updatedChange) return { success: false, error: 'change not found' }

    const nextDetail = await this.rebuildReviewState(request.reviewId)
    const nextDocument = nextDetail.documents.find((item) => item.id === updatedChange.document_id)
    const nextChange = nextDetail.changes.find((item) => item.id === updatedChange.id)
    return {
      success: true,
      review: nextDetail.review,
      document: nextDocument,
      change: nextChange
    }
  }

  public async validateCommit(
    request: ValidateDraftCommitRequest
  ): Promise<ValidateDraftCommitResponse> {
    const detail = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!detail) {
      return {
        ready: false,
        issues: [
          {
            code: 'review_not_found',
            message: '草稿审阅不存在或已被移除。'
          }
        ]
      }
    }

    const issues: DraftCommitValidationIssue[] = []
    const status = detail.review.status
    if (status === 'committing' || status === 'committed' || status === 'cancelled') {
      issues.push({
        code: 'review_not_ready',
        message: '当前草稿状态不允许提交。'
      })
    }

    if (detail.changes.some((change) => change.decision === 'pending')) {
      issues.push({
        code: 'pending_changes',
        message: '仍有未决修改，必须先逐块接受或拒绝。'
      })
    }

    const freshnessResults = await Promise.all(
      detail.documents.map(async (document) => ({
        document,
        fresh: await isSourceVersionFresh(document.source_path, document.source_version)
      }))
    )
    freshnessResults.forEach(({ document, fresh }) => {
      if (!fresh) {
        issues.push({
          code: 'source_changed',
          message: '源文件已发生变化，无法基于旧草稿直接提交。',
          documentId: document.id,
          sourcePath: document.source_path
        })
      }
    })

    return {
      ready: issues.length === 0,
      issues
    }
  }

  public async commitReview(
    request: CommitDraftReviewRequest
  ): Promise<CommitDraftReviewResponse> {
    const detail = await this.draftReviewStore.getReviewDetail(request.reviewId)
    if (!detail) return { success: false, error: 'review not found' }
    if (!request.overwrite) {
      return { success: false, error: 'overwrite confirmation is required' }
    }

    const validation = await this.validateCommit({ reviewId: request.reviewId })
    if (!validation.ready) {
      const hasConflict = validation.issues.some((issue) => issue.code === 'source_changed')
      const now = Date.now()
      const errorMessage = validation.issues.map((issue) => issue.message).join('；')
      let conflictJob: DraftCommitJob | undefined
      if (hasConflict) {
        conflictJob = {
          id: randomUUID(),
          review_id: request.reviewId,
          status: 'conflicted',
          document_count: detail.documents.length,
          results: [],
          started_at: now,
          completed_at: now,
          error: errorMessage
        }
        await this.appendCommitJob(request.reviewId, conflictJob)
      }
      await this.updateReviewSummary({
        ...detail.review,
        status: hasConflict ? 'conflicted' : detail.review.status,
        updated_at: now,
        last_error: errorMessage
      })
      return { success: false, job: conflictJob, error: errorMessage }
    }

    const now = Date.now()
    const job: DraftCommitJob = {
      id: randomUUID(),
      review_id: request.reviewId,
      status: 'running',
      document_count: detail.documents.filter((document) =>
        detail.changes.some(
          (change) => change.document_id === document.id && change.decision === 'accepted'
        )
      ).length,
      results: [],
      started_at: now
    }
    await this.appendCommitJob(request.reviewId, job)
    await this.updateReviewSummary({
      ...detail.review,
      status: 'committing',
      updated_at: now,
      last_error: undefined
    })

    const commitRunId = `draft-commit-${job.id}`
    const results: DraftCommitResultItem[] = []

    try {
      const client = getDocxWorkerClient()
      for (const document of detail.documents) {
        const acceptedChanges = detail.changes
          .filter((change) => change.document_id === document.id && change.decision === 'accepted')
          .sort((left, right) => left.order_index - right.order_index)
        if (acceptedChanges.length === 0) continue

        const openResponse = await client.call({
          runId: commitRunId,
          action: 'open',
          payload: {
            sourcePath: document.source_path
          }
        })
        if (!openResponse.ok || openResponse.payload.action !== 'open') {
          throw new Error(openResponse.ok ? 'commit open worker protocol mismatch' : openResponse.error)
        }

        let currentDocId = openResponse.payload.docId
        const appliedGroups = new Set<string>()
        for (const change of acceptedChanges) {
          const groupId = getMetadataGroupId(change.metadata)
          if (groupId && appliedGroups.has(groupId)) continue
          if (groupId) appliedGroups.add(groupId)
          const op = parseDocxOpFromMetadata(change.metadata)
          if (!op) throw new Error(`missing docx op metadata for change ${change.id}`)

          const applyResponse = await client.call({
            runId: commitRunId,
            action: 'apply_ops',
            payload: {
              docId: currentDocId,
              ops: [op]
            }
          })
          if (!applyResponse.ok || applyResponse.payload.action !== 'apply_ops') {
            throw new Error(
              applyResponse.ok ? 'commit apply worker protocol mismatch' : applyResponse.error
            )
          }
          currentDocId = applyResponse.payload.newDocId
        }

        const saveResponse = await client.call({
          runId: commitRunId,
          action: 'save',
          payload: {
            docId: currentDocId,
            outPath: document.source_path
          }
        })
        if (!saveResponse.ok || saveResponse.payload.action !== 'save') {
          throw new Error(saveResponse.ok ? 'commit save worker protocol mismatch' : saveResponse.error)
        }

        results.push({
          draft_document_id: document.id,
          output_path: document.source_path,
          operation: 'updated',
          checksum: saveResponse.payload.checksum,
          byte_size: saveResponse.payload.byteSize
        })
      }

      const completedJob: DraftCommitJob = {
        ...job,
        status: 'completed',
        results,
        completed_at: Date.now()
      }
      const committedAt = completedJob.completed_at || Date.now()
      const archivedDetail = createArchivedCommittedDetail({
        detail,
        completedJob,
        committedAt
      })
      await this.draftReviewStore.saveReviewDetail(archivedDetail)
      await Promise.all(
        collectArtifactPaths(detail).map(async (artifactPath) => {
          try {
            await fs.rm(artifactPath, { force: true })
          } catch {
            return
          }
        })
      )
      return {
        success: true,
        job: completedJob
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedJob: DraftCommitJob = {
        ...job,
        status: 'failed',
        results,
        completed_at: Date.now(),
        error: message
      }
      await this.replaceCommitJob(request.reviewId, failedJob)
      await this.updateReviewSummary({
        ...detail.review,
        status: 'failed',
        updated_at: Date.now(),
        last_error: message
      })
      return {
        success: false,
        job: failedJob,
        error: message
      }
    } finally {
      await releaseDocxRunSession(commitRunId)
    }
  }

  private async rebuildReviewState(reviewId: string): Promise<DraftReviewDetail> {
    const detail = await this.draftReviewStore.getReviewDetail(reviewId)
    if (!detail) throw new Error('review not found')

    const documentMap = new Map(
      detail.documents.map((document) => [
        document.id,
        {
          ...document,
          pending_change_count: 0,
          accepted_change_count: 0,
          rejected_change_count: 0,
          total_change_count: 0,
          updated_at: Date.now()
        }
      ])
    )

    detail.changes.forEach((change) => {
      const document = documentMap.get(change.document_id)
      if (!document) return
      document.total_change_count += 1
      if (change.decision === 'accepted') document.accepted_change_count += 1
      else if (change.decision === 'rejected') document.rejected_change_count += 1
      else document.pending_change_count += 1
    })

    const documents = [...documentMap.values()]
    const review: DraftReviewSummary = {
      ...detail.review,
      status: toReviewStatus(
        detail.changes.some((change) => change.decision === 'pending'),
        detail.review.status
      ),
      change_count: detail.changes.length,
      pending_change_count: detail.changes.filter((change) => change.decision === 'pending').length,
      accepted_change_count: detail.changes.filter((change) => change.decision === 'accepted').length,
      rejected_change_count: detail.changes.filter((change) => change.decision === 'rejected').length,
      updated_at: Date.now(),
      last_error: undefined
    }

    await this.draftReviewStore.saveReview(review)
    await this.draftReviewStore.replaceDocuments(reviewId, documents)
    return {
      review,
      documents,
      changes: detail.changes,
      commit_jobs: detail.commit_jobs
    }
  }

  private async updateReviewSummary(review: DraftReviewSummary): Promise<void> {
    await this.draftReviewStore.saveReview(review)
  }

  private async appendCommitJob(reviewId: string, nextJob: DraftCommitJob): Promise<void> {
    const jobs = await this.draftReviewStore.listCommitJobs(reviewId)
    await this.draftReviewStore.replaceCommitJobs(reviewId, [...jobs, nextJob])
  }

  private async replaceCommitJob(reviewId: string, nextJob: DraftCommitJob): Promise<void> {
    const jobs = await this.draftReviewStore.listCommitJobs(reviewId)
    const withoutCurrent = jobs.filter((job) => job.id !== nextJob.id)
    await this.draftReviewStore.replaceCommitJobs(reviewId, [...withoutCurrent, nextJob])
  }
}
