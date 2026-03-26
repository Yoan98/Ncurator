import React, { useEffect, useMemo, useState } from 'react'
import { Button, Spin } from 'antd'
import { FileSyncOutlined, FolderOpenOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import type { DraftReviewDetail, ValidateDraftCommitResponse } from '../../../../shared/types'
import EmbeddedFileViewer from '../fileRenders/EmbeddedFileViewer'
import { REVIEW_STATUS_META } from './constants'
import { formatLocatorSummary } from './utils'
import type { AssistantTurnViewModel, WorkbenchFileRef } from './types'
import { workbenchSelectors } from '../../testing/selectors'

const ACTIVE_CONFIRM_STATUSES = new Set(['pending_confirm', 'conflicted', 'failed'])

const getEndedStateMessage = (status: DraftReviewDetail['review']['status']): string => {
  if (status === 'committed') {
    return '确认副本已清理，修改已写回源文件。'
  }
  if (status === 'discarded') {
    return '确认副本已清理，源文件未被替换。'
  }
  if (status === 'superseded') {
    return '当前确认会话已失效，请查看最新确认文档。'
  }
  return '当前确认副本不可用，只能继续查看源文件。'
}

type WorkbenchReviewPanelProps = {
  review: DraftReviewDetail | null
  loading: boolean
  validation: ValidateDraftCommitResponse | null
  validating: boolean
  committing: boolean
  discarding: boolean
  turn?: AssistantTurnViewModel
  onRefreshValidation: () => void
  onCommit: () => void
  onDiscard: () => void
  onOpenFile: (file: WorkbenchFileRef) => void
  onOpenPath: (filePath: string) => Promise<void>
  onOpenWithApplication: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchReviewPanel: React.FC<WorkbenchReviewPanelProps> = ({
  review,
  loading,
  validation,
  validating,
  committing,
  discarding,
  turn,
  onRefreshValidation,
  onCommit,
  onDiscard,
  onOpenFile,
  onOpenPath,
  onOpenWithApplication,
  onRevealPath
}) => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)

  useEffect(() => {
    if (!review) {
      setSelectedDocumentId(null)
      setSelectedChangeId(null)
      return
    }
    const nextDocumentId =
      review.documents.find((item) => item.id === selectedDocumentId)?.id ||
      review.documents[0]?.id ||
      null
    setSelectedDocumentId(nextDocumentId)
  }, [review, selectedDocumentId])

  const selectedDocument = review?.documents.find((item) => item.id === selectedDocumentId) || null
  const documentChanges = useMemo(() => {
    if (!review || !selectedDocumentId) return []
    return review.changes
      .filter((item) => item.document_id === selectedDocumentId)
      .sort((left, right) => left.order_index - right.order_index)
  }, [review, selectedDocumentId])

  useEffect(() => {
    const nextChangeId =
      documentChanges.find((item) => item.id === selectedChangeId)?.id ||
      documentChanges[0]?.id ||
      null
    setSelectedChangeId(nextChangeId)
  }, [documentChanges, selectedChangeId])

  const selectedChange = documentChanges.find((item) => item.id === selectedChangeId) || null
  const latestCommitJob =
    review?.commit_jobs
      .slice()
      .sort((left, right) => left.started_at - right.started_at)
      .at(-1) || null
  const reviewStatusMeta = review ? REVIEW_STATUS_META[review.review.status] : null
  const confirmArtifactPath = selectedDocument?.confirm_artifact_path
  const confirmFileName = selectedDocument
    ? `${selectedDocument.source_name.replace(/\.docx$/i, '')}-确认文档.docx`
    : undefined
  const sourceFile: WorkbenchFileRef | null = selectedDocument
    ? {
        path: selectedDocument.source_path,
        fileName: selectedDocument.source_name,
        origin: 'source',
        reviewId: review?.review.id,
        draftDocumentId: selectedDocument.id,
        format: selectedDocument.format
      }
    : null
  const isActiveConfirmSession =
    Boolean(review && confirmArtifactPath && ACTIVE_CONFIRM_STATUSES.has(review.review.status))
  const endedStateMessage = review ? getEndedStateMessage(review.review.status) : ''
  const commitDisabled =
    !review ||
    !isActiveConfirmSession ||
    !validation?.ready ||
    committing ||
    validating ||
    review.review.status === 'committing' ||
    review.review.status === 'committed' ||
    review.review.status === 'discarded' ||
    review.review.status === 'superseded'

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid={workbenchSelectors.reviewPanel}
      >
        <Spin />
      </div>
    )
  }

  if (!review || !selectedDocument) {
    return (
      <div
        className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-[#E5E5E4] bg-[#FAFAF9] text-sm text-[#999999]"
        data-testid={workbenchSelectors.reviewPanel}
      >
        当前没有待确认的文档。
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={workbenchSelectors.reviewPanel}>
      <div className="space-y-4 border-b border-[#E5E5E4] pb-4">
        <div className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#1F1F1F]">{review.review.title}</div>
              <div className="mt-2 break-all text-xs text-[#666666]">
                {selectedDocument.source_path}
              </div>
              <div className="mt-3 text-sm leading-relaxed text-[#666666]">
                {isActiveConfirmSession
                  ? '右侧展示的是 AI 生成的确认文档副本。确认后会清除标记并替换源文件。'
                  : endedStateMessage}
              </div>
            </div>
            {reviewStatusMeta ? (
              <span
                className={`rounded-full border px-3 py-1 text-[11px] ${reviewStatusMeta.className}`}
              >
                {reviewStatusMeta.label}
              </span>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {review.documents.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => setSelectedDocumentId(document.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-all duration-200 ${
                  document.id === selectedDocumentId
                    ? 'border-[#D97757] bg-white text-[#D97757]'
                    : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666] hover:border-[#D97757] hover:text-[#D97757]'
                }`}
              >
                {document.source_name}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-[#E5E5E4] bg-white px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
            修改导航
          </div>
          <div className="mt-3 max-h-[180px] space-y-2 overflow-auto pr-1">
            {documentChanges.map((change, index) => (
              <button
                key={change.id}
                type="button"
                onClick={() => setSelectedChangeId(change.id)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                  change.id === selectedChangeId
                    ? 'border-[#D97757] bg-[#FCFBF8]'
                    : 'border-[#E5E5E4] bg-[#FAFAF9] hover:border-[#D97757]'
                }`}
                data-testid={`${workbenchSelectors.reviewChangePrefix}-${change.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1F1F1F]">{change.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#666666]">
                      {change.summary}
                    </div>
                    <div className="mt-2 text-[11px] text-[#999999]">
                      {formatLocatorSummary(change)}
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-[#666666]">
                    {index + 1}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto py-4">
        <div className="rounded-[18px] border border-[#E5E5E4] bg-white px-4 py-4">
          <div className="flex flex-wrap gap-2">
            {isActiveConfirmSession && confirmArtifactPath ? (
              <Button size="small" onClick={() => void onOpenPath(confirmArtifactPath)}>
                系统默认打开
              </Button>
            ) : null}
            {isActiveConfirmSession && confirmArtifactPath ? (
              <Button size="small" onClick={() => void onOpenWithApplication(confirmArtifactPath)}>
                选择其他应用打开...
              </Button>
            ) : null}
            {isActiveConfirmSession && confirmArtifactPath && confirmFileName ? (
              <Button
                size="small"
                onClick={() =>
                  onOpenFile({
                    path: confirmArtifactPath,
                    fileName: confirmFileName,
                    origin: 'edited_draft',
                    reviewId: review.review.id,
                    draftDocumentId: selectedDocument.id,
                    format: selectedDocument.format
                  })
                }
              >
                在工作台中打开
              </Button>
            ) : null}
            {sourceFile ? (
              <Button size="small" onClick={() => onOpenFile(sourceFile)}>
                打开源文件
              </Button>
            ) : null}
            <Button
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => void onRevealPath(selectedDocument.source_path)}
            >
              定位源文件
            </Button>
          </div>
        </div>

        {isActiveConfirmSession && confirmArtifactPath ? (
          <>
            <div className="min-h-[420px]">
              <EmbeddedFileViewer
                filePath={confirmArtifactPath}
                fileName={confirmFileName || selectedDocument.source_name}
                anchorName={selectedChange?.anchor_name}
                emptyText="当前确认文档暂时不可预览。"
              />
            </div>

            <div
              className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4"
              data-testid={workbenchSelectors.reviewValidation}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-[#1F1F1F]">提交前校验</div>
                  <div className="mt-1 text-xs text-[#666666]">
                    校验通过后会对确认文档做 normalize，再替换源文件。
                  </div>
                </div>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={onRefreshValidation}
                  loading={validating}
                >
                  重新校验
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {validation?.issues.length ? (
                  validation.issues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${index}`}
                      className="rounded-xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-3 text-sm text-[#8A6510]"
                    >
                      <div>{issue.message}</div>
                      {issue.sourcePath ? (
                        <div className="mt-1 break-all text-xs text-[#999999]">{issue.sourcePath}</div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-[#DCEBD7] bg-[#F3FAF0] px-3 py-3 text-sm text-[#4F7A46]">
                    校验通过，可以确认替换源文件。
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="primary"
                size="large"
                icon={<FileSyncOutlined />}
                onClick={onCommit}
                loading={committing}
                disabled={commitDisabled}
                data-testid={workbenchSelectors.reviewCommitButton}
              >
                确认替换源文件
              </Button>
              <Button
                size="large"
                icon={<StopOutlined />}
                onClick={onDiscard}
                loading={discarding}
                disabled={
                  committing ||
                  discarding ||
                  !isActiveConfirmSession ||
                  review.review.status === 'committed' ||
                  review.review.status === 'discarded' ||
                  review.review.status === 'superseded'
                }
                data-testid={workbenchSelectors.reviewDiscardButton}
              >
                放弃本次修改
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-5">
            <div className="text-[13px] font-semibold text-[#1F1F1F]">确认文档状态</div>
            <div className="mt-2 text-sm leading-relaxed text-[#666666]">{endedStateMessage}</div>
          </div>
        )}

        {turn?.steps.length ? (
          <section className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
              相关步骤
            </div>
            <div className="mt-3 space-y-2">
              {turn.steps.map((step) => (
                <div key={step.id} className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-3">
                  <div className="text-[13px] font-medium text-[#1F1F1F]">{step.summary}</div>
                  <div className="mt-1 text-xs text-[#666666]">{step.tool}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {latestCommitJob ? (
          <div
            className="rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4"
            data-testid={workbenchSelectors.reviewCommitResults}
          >
            <div className="text-[13px] font-semibold text-[#1F1F1F]">最近一次提交结果</div>
            <div className="mt-3 space-y-2">
              {latestCommitJob.results.map((result) => (
                <div
                  key={`${result.draft_document_id}-${result.output_path}`}
                  className="rounded-xl border border-[#E5E5E4] bg-white px-3 py-3"
                >
                  <div className="break-all text-sm text-[#1F1F1F]">{result.output_path}</div>
                  <div className="mt-1 text-xs text-[#666666]">
                    {result.operation} ·{' '}
                    {result.byte_size ? `${result.byte_size} bytes` : 'size unknown'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default WorkbenchReviewPanel
