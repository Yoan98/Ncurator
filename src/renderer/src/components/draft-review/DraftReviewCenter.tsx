import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Spin } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  FileSyncOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons'
import type {
  DraftChangeResolution,
  DraftReviewDetail,
  DraftReviewSummary,
  ValidateDraftCommitResponse
} from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'
import { getDraftDiffRenderer } from './renderers'

const reviewStatusLabel: Record<DraftReviewSummary['status'], string> = {
  review_pending: '待审阅',
  commit_ready: '可提交',
  committing: '提交中',
  committed: '已提交',
  conflicted: '有冲突',
  cancelled: '已取消',
  failed: '提交失败'
}

const reviewStatusTone: Record<DraftReviewSummary['status'], string> = {
  review_pending: 'bg-[#FBF5F2] text-[#D97757]',
  commit_ready: 'bg-[#F3FAF0] text-[#4F7A46]',
  committing: 'bg-[#FFF9ED] text-[#8A6510]',
  committed: 'bg-[#F3FAF0] text-[#4F7A46]',
  conflicted: 'bg-[#FFF1F0] text-[#C2413B]',
  cancelled: 'bg-[#F5F5F4] text-[#666666]',
  failed: 'bg-[#FFF1F0] text-[#C2413B]'
}

const changeDecisionTone: Record<string, string> = {
  pending: 'bg-[#FFF9ED] text-[#8A6510]',
  accepted: 'bg-[#F3FAF0] text-[#4F7A46]',
  rejected: 'bg-[#F5F5F4] text-[#666666]'
}

type DraftReviewCenterProps = {
  reviews: DraftReviewSummary[]
  activeReviewId: string | null
  activeReview: DraftReviewDetail | null
  loading: boolean
  validation: ValidateDraftCommitResponse | null
  validating: boolean
  busyChangeIds: string[]
  bulkApplying: boolean
  committing: boolean
  onSelectReview: (reviewId: string) => void
  onSetDecision: (changeId: string, decision: DraftChangeResolution) => void
  onSetAllPending: (decision: DraftChangeResolution) => void
  onRefreshValidation: () => void
  onCommit: () => void
  onOpenPreview: (filePath: string, fileName: string) => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const DraftReviewCenter: React.FC<DraftReviewCenterProps> = ({
  reviews,
  activeReviewId,
  activeReview,
  loading,
  validation,
  validating,
  busyChangeIds,
  bulkApplying,
  committing,
  onSelectReview,
  onSetDecision,
  onSetAllPending,
  onRefreshValidation,
  onCommit,
  onOpenPreview,
  onOpenPath,
  onRevealPath
}) => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeReview) {
      setSelectedDocumentId(null)
      setSelectedChangeId(null)
      return
    }
    const nextDocumentId =
      activeReview.documents.find((document) => document.id === selectedDocumentId)?.id ||
      activeReview.documents[0]?.id ||
      null
    setSelectedDocumentId(nextDocumentId)
  }, [activeReview, selectedDocumentId])

  const selectedDocument =
    activeReview?.documents.find((document) => document.id === selectedDocumentId) || null

  const selectedDocumentChanges = useMemo(() => {
    if (!activeReview || !selectedDocumentId) return []
    return activeReview.changes
      .filter((change) => change.document_id === selectedDocumentId)
      .sort((left, right) => left.order_index - right.order_index)
  }, [activeReview, selectedDocumentId])

  useEffect(() => {
    const nextChangeId =
      selectedDocumentChanges.find((change) => change.id === selectedChangeId)?.id ||
      selectedDocumentChanges[0]?.id ||
      null
    setSelectedChangeId(nextChangeId)
  }, [selectedChangeId, selectedDocumentChanges])

  const selectedChange =
    selectedDocumentChanges.find((change) => change.id === selectedChangeId) || null

  const latestCommitJob =
    activeReview?.commit_jobs
      .slice()
      .sort((left, right) => left.started_at - right.started_at)
      .at(-1) || null

  const pendingCount = activeReview?.review.pending_change_count || 0
  const commitDisabled =
    !activeReview ||
    committing ||
    validating ||
    !validation?.ready ||
    activeReview.review.status === 'committed' ||
    activeReview.review.status === 'committing'

  const rendererRegistration = selectedDocument
    ? getDraftDiffRenderer(selectedDocument.format)
    : null

  return (
    <div className="px-6 pt-4" data-testid={workbenchSelectors.reviewCenter}>
      <Card className="rounded-2xl border border-[#E5E5E4] bg-white shadow-sm">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-[#1F1F1F]">草稿审阅中心</div>
              <div className="mt-1 text-xs text-[#666666]">
                运行阶段不会改动真实文件；所有块级修改都在这里统一确认后才提交。
              </div>
            </div>
            {activeReview ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs ${reviewStatusTone[activeReview.review.status]}`}
                  data-review-status={activeReview.review.status}
                >
                  {reviewStatusLabel[activeReview.review.status]}
                </span>
                <span className="rounded-full bg-[#F5F5F4] px-3 py-1 text-xs text-[#666666]">
                  {activeReview.review.document_count} 个文档
                </span>
                <span className="rounded-full bg-[#F5F5F4] px-3 py-1 text-xs text-[#666666]">
                  {activeReview.review.change_count} 处修改
                </span>
              </div>
            ) : null}
          </div>

          <div className="space-y-3" data-testid={workbenchSelectors.reviewList}>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">审阅集合</div>
            {loading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-6 text-sm text-[#666666]">
                <Spin size="small" />
                <span>正在恢复草稿审阅状态...</span>
              </div>
            ) : reviews.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-6 text-sm text-[#999999]">
                当前会话还没有待审阅的草稿结果。
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {reviews.map((review) => {
                  const active = review.id === activeReviewId
                  return (
                    <button
                      key={review.id}
                      type="button"
                      onClick={() => onSelectReview(review.id)}
                      data-testid={`${workbenchSelectors.reviewItemPrefix}-${review.id}`}
                      className={`rounded-2xl border px-4 py-3 text-left transition-all duration-200 ${
                        active
                          ? 'border-[#D97757] bg-[#FBF5F2]'
                          : 'border-[#E5E5E4] bg-white hover:-translate-y-0.5 hover:border-[#D4D4D3]'
                      }`}
                    >
                      <div className="text-sm font-medium text-[#1F1F1F]">{review.title}</div>
                      <div className="mt-1 text-xs text-[#666666]">
                        {review.document_count} 个文档 · {review.change_count} 处修改
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {activeReview ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[240px_280px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">文档列表</div>
                    <span className="text-xs text-[#999999]">{activeReview.documents.length}</span>
                  </div>
                  <div className="space-y-2" data-testid={workbenchSelectors.reviewDocumentList}>
                    {activeReview.documents.map((document) => {
                      const active = document.id === selectedDocumentId
                      return (
                        <button
                          key={document.id}
                          type="button"
                          onClick={() => setSelectedDocumentId(document.id)}
                          data-testid={`${workbenchSelectors.reviewDocumentPrefix}-${document.id}`}
                          className={`w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                            active
                              ? 'border-[#D97757] bg-[#FBF5F2]'
                              : 'border-[#E5E5E4] bg-[#F8F8F7] hover:-translate-y-0.5 hover:border-[#D4D4D3]'
                          }`}
                        >
                          <div className="text-sm font-medium text-[#1F1F1F] truncate">{document.source_name}</div>
                          <div className="mt-1 text-xs text-[#666666]">{document.format.toUpperCase()}</div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#666666]">
                            <span className="rounded-full bg-white px-2 py-1">待决 {document.pending_change_count}</span>
                            <span className="rounded-full bg-white px-2 py-1">接受 {document.accepted_change_count}</span>
                            <span className="rounded-full bg-white px-2 py-1">拒绝 {document.rejected_change_count}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">变更单元</div>
                    <div className="flex gap-2">
                      <Button
                        size="small"
                        onClick={() => onSetAllPending('accepted')}
                        loading={bulkApplying}
                        disabled={bulkApplying || committing || pendingCount === 0}
                        data-testid={workbenchSelectors.reviewAcceptAllButton}
                      >
                        全部接受
                      </Button>
                      <Button
                        size="small"
                        onClick={() => onSetAllPending('rejected')}
                        loading={bulkApplying}
                        disabled={bulkApplying || committing || pendingCount === 0}
                        data-testid={workbenchSelectors.reviewRejectAllButton}
                      >
                        全部拒绝
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2" data-testid={workbenchSelectors.reviewChangeList}>
                    {selectedDocumentChanges.map((change) => {
                      const active = change.id === selectedChangeId
                      const busy = busyChangeIds.includes(change.id) || bulkApplying || committing
                      return (
                        <div
                          key={change.id}
                          className={`rounded-2xl border px-3 py-3 transition-all duration-200 ${
                            active ? 'border-[#D97757] bg-[#FBF5F2]' : 'border-[#E5E5E4] bg-white'
                          }`}
                          data-testid={`${workbenchSelectors.reviewChangePrefix}-${change.id}`}
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => setSelectedChangeId(change.id)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-[#1F1F1F]">{change.title}</div>
                              <span className={`rounded-full px-2 py-1 text-[11px] ${changeDecisionTone[change.decision]}`}>
                                {change.decision}
                              </span>
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-[#666666] line-clamp-3">{change.summary}</div>
                          </button>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="small"
                              type={change.decision === 'accepted' ? 'primary' : 'default'}
                              icon={<CheckOutlined />}
                              loading={busy && change.decision !== 'rejected'}
                              disabled={busy || activeReview.review.status === 'committed'}
                              onClick={() => onSetDecision(change.id, 'accepted')}
                              data-testid={`${workbenchSelectors.reviewChangeAcceptPrefix}-${change.id}`}
                            >
                              接受
                            </Button>
                            <Button
                              size="small"
                              type={change.decision === 'rejected' ? 'primary' : 'default'}
                              danger={change.decision === 'rejected'}
                              icon={<CloseOutlined />}
                              loading={busy && change.decision !== 'accepted'}
                              disabled={busy || activeReview.review.status === 'committed'}
                              onClick={() => onSetDecision(change.id, 'rejected')}
                              data-testid={`${workbenchSelectors.reviewChangeRejectPrefix}-${change.id}`}
                            >
                              拒绝
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">差异预览</div>
                      {selectedDocument ? (
                        <div className="mt-1 text-sm text-[#1F1F1F]">{selectedDocument.source_name}</div>
                      ) : null}
                    </div>
                    {selectedDocument?.preview_artifact_path ? (
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => onOpenPreview(selectedDocument.preview_artifact_path || '', selectedDocument.source_name)}
                      >
                        预览文档
                      </Button>
                    ) : null}
                  </div>

                  {rendererRegistration && selectedDocument ? (
                    <rendererRegistration.component
                      document={selectedDocument}
                      change={selectedChange}
                      onOpenPreview={onOpenPreview}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[#E5E5E4] bg-[#F8F8F7] px-4 py-8 text-sm text-[#999999]">
                      当前还没有可展示的文档差异。
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[#E5E5E4] bg-[#F8F8F7] px-4 py-4" data-testid={workbenchSelectors.reviewValidation} data-ready={validation?.ready ? 'true' : 'false'}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[#1F1F1F]">提交前校验</div>
                    <div className="mt-1 text-xs text-[#666666]">
                      所有变更都明确决策后，才允许把接受的修改写回真实文件。
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<ReloadOutlined />} onClick={onRefreshValidation} loading={validating}>
                      重新校验
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      icon={<FileSyncOutlined />}
                      onClick={onCommit}
                      loading={committing}
                      disabled={commitDisabled}
                      data-testid={workbenchSelectors.reviewCommitButton}
                    >
                      确认并提交到源文件
                    </Button>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {validation?.issues.length ? (
                    validation.issues.map((issue, index) => (
                      <div
                        key={`${issue.code}-${index}`}
                        className="flex items-start gap-2 rounded-xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-3 text-sm text-[#8A6510]"
                        data-testid={issue.code === 'source_changed' ? workbenchSelectors.reviewConflict : undefined}
                      >
                        <WarningOutlined className="mt-0.5" />
                        <div>
                          <div>{issue.message}</div>
                          {issue.sourcePath ? <div className="mt-1 text-xs text-[#999999] break-all">{issue.sourcePath}</div> : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-[#DCEBD7] bg-[#F3FAF0] px-3 py-3 text-sm text-[#4F7A46]">
                      <CheckOutlined />
                      <span>校验通过，可以提交接受的修改。</span>
                    </div>
                  )}
                </div>
              </div>

              {latestCommitJob ? (
                <div className="rounded-2xl border border-[#E5E5E4] bg-white px-4 py-4" data-testid={workbenchSelectors.reviewCommitResults}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#1F1F1F]">最近一次提交结果</div>
                      <div className="mt-1 text-xs text-[#666666]">状态：{latestCommitJob.status}</div>
                    </div>
                    {latestCommitJob.error ? <span className="text-xs text-[#C2413B]">{latestCommitJob.error}</span> : null}
                  </div>
                  <div className="mt-4 space-y-2">
                    {latestCommitJob.results.map((result) => (
                      <div key={`${result.draft_document_id}-${result.output_path}`} className="rounded-xl border border-[#E5E5E4] bg-[#F8F8F7] px-3 py-3">
                        <div className="text-sm font-medium text-[#1F1F1F] break-all">{result.output_path}</div>
                        <div className="mt-1 text-xs text-[#666666]">
                          {result.operation} · {result.byte_size ? `${result.byte_size} bytes` : 'size unknown'}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void onRevealPath(result.output_path)}>
                            定位
                          </Button>
                          <Button size="small" icon={<EyeOutlined />} onClick={() => void onOpenPath(result.output_path)}>
                            打开
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>
    </div>
  )
}

export default DraftReviewCenter
