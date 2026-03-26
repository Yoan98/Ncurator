import { fireEvent, render, screen } from '@testing-library/react'
import type {
  DraftReviewChange,
  DraftReviewDetail,
  DraftReviewDocument,
  DraftReviewSummary,
  ValidateDraftCommitResponse
} from '../../../src/shared/types'
import WorkbenchReviewPanel from '../../../src/renderer/src/components/workbench/WorkbenchReviewPanel'

vi.mock('../../../src/renderer/src/components/fileRenders/EmbeddedFileViewer', () => ({
  default: (props: { fileName: string; anchorName?: string }) => (
    <div data-testid="embedded-file-viewer">
      {props.fileName}
      {props.anchorName ? `:${props.anchorName}` : ''}
    </div>
  )
}))

const createReviewSummary = (
  input: Partial<DraftReviewSummary> & Pick<DraftReviewSummary, 'id' | 'run_id' | 'status'>
): DraftReviewSummary => ({
  id: input.id,
  session_id: input.session_id || 'session-1',
  run_id: input.run_id,
  status: input.status,
  title: input.title || '确认文档',
  document_count: input.document_count || 1,
  change_count: input.change_count || 1,
  pending_change_count: input.pending_change_count || 1,
  accepted_change_count: input.accepted_change_count || 0,
  rejected_change_count: input.rejected_change_count || 0,
  created_at: input.created_at || 1,
  updated_at: input.updated_at || 1,
  completed_at: input.completed_at,
  committed_at: input.committed_at,
  last_error: input.last_error
})

const createDocument = (
  input: Partial<DraftReviewDocument> & Pick<DraftReviewDocument, 'id' | 'review_id' | 'source_path'>
): DraftReviewDocument => ({
  id: input.id,
  review_id: input.review_id,
  source_document_id: input.source_document_id,
  source_path: input.source_path,
  source_name: input.source_name || '示例文档.docx',
  format: input.format || 'docx',
  review_render_kind: input.review_render_kind,
  latest_draft_snapshot_id: input.latest_draft_snapshot_id || 'doc-1',
  confirm_artifact_path: input.confirm_artifact_path,
  manifest_artifact_path: input.manifest_artifact_path,
  effective_draft_artifact_path: input.effective_draft_artifact_path,
  source_version: input.source_version || {},
  total_change_count: input.total_change_count || 1,
  pending_change_count: input.pending_change_count || 1,
  accepted_change_count: input.accepted_change_count || 0,
  rejected_change_count: input.rejected_change_count || 0,
  created_at: input.created_at || 1,
  updated_at: input.updated_at || 1
})

const createChange = (
  input: Partial<DraftReviewChange> &
    Pick<DraftReviewChange, 'id' | 'review_id' | 'document_id' | 'order_index'>
): DraftReviewChange => ({
  id: input.id,
  review_id: input.review_id,
  document_id: input.document_id,
  order_index: input.order_index,
  change_kind: input.change_kind || 'block',
  title: input.title || '更新标题',
  summary: input.summary || '更新摘要',
  decision: input.decision || 'pending',
  before_text: input.before_text || 'before',
  after_text: input.after_text || 'after',
  anchor_name: input.anchor_name || 'ncurator-change-anchor-1',
  locator: input.locator || {},
  diff_hunks: input.diff_hunks,
  source_step_ref: input.source_step_ref,
  metadata: input.metadata,
  created_at: input.created_at || 1,
  updated_at: input.updated_at || 1
})

const baseValidation: ValidateDraftCommitResponse = {
  ready: true,
  issues: []
}

const createReviewDetail = (status: DraftReviewSummary['status']): DraftReviewDetail => {
  const review = createReviewSummary({
    id: `review-${status}`,
    run_id: 'run-1',
    status
  })
  const document = createDocument({
    id: `doc-${status}`,
    review_id: review.id,
    source_path: '/tmp/source.docx',
    confirm_artifact_path:
      status === 'pending_confirm' ? '/tmp/confirm-copy.docx' : undefined
  })

  return {
    review,
    documents: [document],
    changes: [
      createChange({
        id: `change-${status}`,
        review_id: review.id,
        document_id: document.id,
        order_index: 1
      })
    ],
    commit_jobs: []
  }
}

describe('WorkbenchReviewPanel', () => {
  it('shows active confirm-copy actions only while the confirm artifact is available', () => {
    render(
      <WorkbenchReviewPanel
        review={createReviewDetail('pending_confirm')}
        loading={false}
        validation={baseValidation}
        validating={false}
        committing={false}
        discarding={false}
        onRefreshValidation={() => {}}
        onCommit={() => {}}
        onDiscard={() => {}}
        onOpenFile={() => {}}
        onOpenPath={async () => {}}
        onOpenWithApplication={async () => {}}
        onRevealPath={async () => {}}
      />
    )

    expect(screen.getByText('系统默认打开')).toBeTruthy()
    expect(screen.getByText('选择其他应用打开...')).toBeTruthy()
    expect(screen.getByText('在工作台中打开')).toBeTruthy()
    expect(screen.getByTestId('embedded-file-viewer')).toBeTruthy()
  })

  it('keeps only explicit source-file actions after the session is committed', () => {
    const onOpenFile = vi.fn()
    const onOpenPath = vi.fn()
    const onOpenWithApplication = vi.fn()

    render(
      <WorkbenchReviewPanel
        review={createReviewDetail('committed')}
        loading={false}
        validation={baseValidation}
        validating={false}
        committing={false}
        discarding={false}
        onRefreshValidation={() => {}}
        onCommit={() => {}}
        onDiscard={() => {}}
        onOpenFile={onOpenFile}
        onOpenPath={onOpenPath}
        onOpenWithApplication={onOpenWithApplication}
        onRevealPath={async () => {}}
      />
    )

    expect(screen.getByText('确认文档状态')).toBeTruthy()
    expect(screen.getAllByText('确认副本已清理，修改已写回源文件。')).toHaveLength(2)
    expect(screen.queryByText('系统默认打开')).toBeNull()
    expect(screen.queryByText('选择其他应用打开...')).toBeNull()
    expect(screen.queryByText('在工作台中打开')).toBeNull()
    expect(screen.queryByTestId('embedded-file-viewer')).toBeNull()

    fireEvent.click(screen.getByText('打开源文件'))

    expect(onOpenFile).toHaveBeenCalledWith({
      path: '/tmp/source.docx',
      fileName: '示例文档.docx',
      origin: 'source',
      reviewId: 'review-committed',
      draftDocumentId: 'doc-committed',
      format: 'docx'
    })
    expect(onOpenPath).not.toHaveBeenCalled()
    expect(onOpenWithApplication).not.toHaveBeenCalled()
  })
})
