import React, { useEffect, useMemo, useState } from 'react'
import { Button, Spin } from 'antd'
import { HiChevronLeft, HiChevronRight } from 'react-icons/hi2'
import type { FileReviewDetail, ValidateFileReviewCommitResponse } from '../../../../shared/types'
import EmbeddedFileViewer from '../fileRenders/EmbeddedFileViewer'
import { REVIEW_STATUS_META } from './constants'
import type { ReviewWorkspaceTab } from './types'
import { workbenchSelectors } from '../../testing/selectors'

const ACTIVE_CONFIRM_STATUSES = new Set(['pending_confirm', 'conflicted', 'failed'])

const getEndedStateMessage = (status: FileReviewDetail['review']['status']): string => {
  if (status === 'committed') {
    return '本文件修改已写回源文件。'
  }
  if (status === 'discarded') {
    return '本文件修改已放弃，源文件保持不变。'
  }
  if (status === 'superseded') {
    return '当前审阅稿已失效，请查看该文件的最新版本。'
  }
  return '当前审阅稿不可继续提交。'
}

type WorkbenchReviewPanelProps = {
  review: FileReviewDetail | null
  loading: boolean
  validation: ValidateFileReviewCommitResponse | null
  committing: boolean
  discarding: boolean
  tabs: ReviewWorkspaceTab[]
  onSelectTab: (fileKey: string) => void
  onCommit: () => void
  onDiscard: () => void
}

const WorkbenchReviewPanel: React.FC<WorkbenchReviewPanelProps> = ({
  review,
  loading,
  validation,
  committing,
  discarding,
  tabs,
  onSelectTab,
  onCommit,
  onDiscard
}) => {
  const [selectedChangeIndex, setSelectedChangeIndex] = useState(0)

  const documentChanges = useMemo(() => {
    if (!review) return []
    return [...review.changes].sort((left, right) => left.order_index - right.order_index)
  }, [review])

  useEffect(() => {
    if (documentChanges.length === 0) {
      setSelectedChangeIndex(0)
      return
    }
    setSelectedChangeIndex((current) => Math.min(current, documentChanges.length - 1))
  }, [documentChanges])

  const selectedChange = documentChanges[selectedChangeIndex] || null
  const reviewStatusMeta = review ? REVIEW_STATUS_META[review.review.status] : null
  const isActiveConfirmSession = Boolean(
    review && review.review.draft_artifact_path && ACTIVE_CONFIRM_STATUSES.has(review.review.status)
  )
  const reviewArtifactPath = review?.review.draft_artifact_path
  const reviewFileName = review
    ? `${review.review.source_name.replace(/\.docx$/i, '')}-审阅稿.docx`
    : undefined
  const viewerPath =
    isActiveConfirmSession && reviewArtifactPath ? reviewArtifactPath : review?.review.source_path
  const viewerName =
    isActiveConfirmSession && reviewFileName ? reviewFileName : review?.review.source_name
  const endedStateMessage = review ? getEndedStateMessage(review.review.status) : ''
  const commitDisabled =
    !review ||
    !isActiveConfirmSession ||
    committing ||
    discarding ||
    review.review.status === 'committing'
  const discardDisabled =
    !review || !isActiveConfirmSession || committing || discarding || review.review.status === 'committing'

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

  if (!review) {
    return (
      <div
        className="ui-inset flex h-full items-center justify-center border-dashed text-sm text-[#999999]"
        data-testid={workbenchSelectors.reviewPanel}
      >
        当前没有待确认的审阅稿。
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={workbenchSelectors.reviewPanel}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[#E5E5E4] bg-[#FCFBF8] px-4 py-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
          data-testid={workbenchSelectors.reviewTabs}
        >
          {tabs.map((tab) => {
            const active = tab.fileKey === review.review.source_path
            return (
              <button
                key={tab.fileKey}
                type="button"
                onClick={() => onSelectTab(tab.fileKey)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-[#D97757] bg-white text-[#D97757]'
                    : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666] hover:border-[#D97757] hover:text-[#D97757]'
                }`}
              >
                <span className="max-w-[180px] truncate">{tab.fileName}</span>
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px]">
                  {tab.changeCount}
                </span>
                {tab.unseen ? <span className="h-1.5 w-1.5 rounded-full bg-[#D97757]" /> : null}
              </button>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {reviewStatusMeta ? (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] ${reviewStatusMeta.className}`}
            >
              {reviewStatusMeta.label}
            </span>
          ) : null}
          <span
            className="min-w-[56px] text-center text-xs text-[#666666]"
            data-testid={workbenchSelectors.reviewCounter}
          >
            {documentChanges.length === 0 ? '0 / 0' : `${selectedChangeIndex + 1} / ${documentChanges.length}`}
          </span>
          <Button
            size="small"
            icon={<HiChevronLeft className="h-3.5 w-3.5" />}
            disabled={documentChanges.length === 0}
            data-testid={workbenchSelectors.reviewPrevButton}
            onClick={() =>
              setSelectedChangeIndex((current) =>
                documentChanges.length === 0
                  ? 0
                  : (current - 1 + documentChanges.length) % documentChanges.length
              )
            }
          />
          <Button
            size="small"
            icon={<HiChevronRight className="h-3.5 w-3.5" />}
            disabled={documentChanges.length === 0}
            data-testid={workbenchSelectors.reviewNextButton}
            onClick={() =>
              setSelectedChangeIndex((current) =>
                documentChanges.length === 0 ? 0 : (current + 1) % documentChanges.length
              )
            }
          />
          <Button
            type="primary"
            size="small"
            onClick={onCommit}
            loading={committing}
            disabled={commitDisabled}
            data-testid={workbenchSelectors.reviewCommitButton}
          >
            确认替换
          </Button>
          <Button
            size="small"
            onClick={onDiscard}
            loading={discarding}
            disabled={discardDisabled}
            data-testid={workbenchSelectors.reviewDiscardButton}
          >
            放弃
          </Button>
        </div>
      </div>

      {!isActiveConfirmSession ? (
        <div className="shrink-0 border-b border-[#E5E5E4] bg-[#F8F8F7] px-4 py-2.5 text-xs text-[#666666]">
          {endedStateMessage}
        </div>
      ) : null}

      {validation && !validation.ready && validation.issues.length > 0 ? (
        <div
          className="shrink-0 border-b border-[#FDECC8] bg-[#FFF9ED] px-4 py-3"
          data-testid={workbenchSelectors.reviewValidation}
        >
          <div className="space-y-2 text-xs text-[#8A6510]">
            {validation.issues.map((issue, index) => (
              <div key={`${issue.code}-${index}`}>
                <div>{issue.message}</div>
                {issue.sourcePath ? (
                  <div className="mt-1 break-all text-[11px] text-[#A27A22]">{issue.sourcePath}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-[#F5F3EE] p-3">
        <EmbeddedFileViewer
          filePath={viewerPath}
          fileName={viewerName}
          anchorName={selectedChange?.anchor_name}
          emptyText="当前审阅稿暂时不可预览。"
        />
      </div>
    </div>
  )
}

export default WorkbenchReviewPanel
