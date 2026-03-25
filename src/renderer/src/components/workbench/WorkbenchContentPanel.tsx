import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty } from 'antd'
import { HiArrowLeft, HiOutlineMagnifyingGlass } from 'react-icons/hi2'
import type { DraftChangeResolution, ValidateDraftCommitResponse } from '../../../../shared/types'
import EmbeddedFileViewer from '../fileRenders/EmbeddedFileViewer'
import { FILE_ORIGIN_LABELS, REVIEW_STATUS_META } from './constants'
import WorkbenchReviewPanel from './WorkbenchReviewPanel'
import type {
  AssistantTurnViewModel,
  SearchWorkbenchTurn,
  WorkbenchContentPanelState,
  WorkbenchFileRef
} from './types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchContentPanelProps = {
  state: WorkbenchContentPanelState
  draftReviewLoading: boolean
  draftCommitValidation: ValidateDraftCommitResponse | null
  draftValidationLoading: boolean
  draftDecisionBusyIds: string[]
  draftBulkApplying: boolean
  draftCommitSubmitting: boolean
  reviewTurn?: AssistantTurnViewModel
  onClose: () => void
  onOpenSearchResult: (turn: SearchWorkbenchTurn, resultIndex: number) => void
  onOpenReview: (reviewId: string) => void
  onOpenFile: (file: WorkbenchFileRef) => void
  onSetDecision: (changeId: string, decision: DraftChangeResolution) => void
  onSetAllPending: (decision: DraftChangeResolution) => void
  onRefreshValidation: () => void
  onCommit: () => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchContentPanel: React.FC<WorkbenchContentPanelProps> = ({
  state,
  draftReviewLoading,
  draftCommitValidation,
  draftValidationLoading,
  draftDecisionBusyIds,
  draftBulkApplying,
  draftCommitSubmitting,
  reviewTurn,
  onClose,
  onOpenSearchResult,
  onOpenReview,
  onOpenFile,
  onSetDecision,
  onSetAllPending,
  onRefreshValidation,
  onCommit,
  onOpenPath,
  onRevealPath
}) => {
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0)
  const searchResetKey = state.kind === 'search_results' ? state.query : state.kind

  useEffect(() => {
    setSelectedSearchIndex(0)
  }, [searchResetKey])

  const selectedSearchResult = useMemo(() => {
    if (state.kind !== 'search_results') return null
    return state.results[selectedSearchIndex] || state.results[0] || null
  }, [selectedSearchIndex, state])

  const reviewStatusMeta =
    state.kind === 'review_session' && state.review
      ? REVIEW_STATUS_META[state.review.review.status]
      : null

  return (
    <aside
      className="flex h-full flex-col border-l border-[#E5E5E4] bg-white"
      data-testid={workbenchSelectors.contentPanel}
    >
      <div className="flex h-11 items-center border-b border-[#E5E5E4] bg-[#FCFBF8] px-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {state.kind !== 'empty' ? (
              <Button
                type="text"
                size="small"
                icon={<HiArrowLeft className="h-4 w-4" />}
                onClick={onClose}
              />
            ) : null}
            <div
              className="truncate text-sm font-semibold text-[#1F1F1F]"
              data-testid={workbenchSelectors.contentPanelTitle}
            >
              {state.title}
            </div>
            {state.kind === 'document_view' ? (
              <span className="rounded-full border border-[#E5E5E4] bg-[#FAFAF9] px-2.5 py-1 text-[11px] text-[#666666]">
                {FILE_ORIGIN_LABELS[state.file.origin]}
              </span>
            ) : null}
            {reviewStatusMeta ? (
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] ${reviewStatusMeta.className}`}
              >
                {reviewStatusMeta.label}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-5 py-5">
        {state.kind === 'empty' ? (
          <div className="flex h-full items-center justify-center rounded-[20px] border border-dashed border-[#E5E5E4] bg-[#FAFAF9]">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
          </div>
        ) : null}

        {state.kind === 'search_results' ? (
          <div className="grid h-full gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <div
              className="overflow-auto rounded-[20px] border border-[#E5E5E4] bg-[#FAFAF9] p-3"
              data-testid={workbenchSelectors.searchResults}
            >
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                <HiOutlineMagnifyingGlass className="h-4 w-4" />
                搜索结果
              </div>
              <div className="space-y-2">
                {state.results.map((result, index) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => setSelectedSearchIndex(index)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                      index === selectedSearchIndex
                        ? 'border-[#D97757] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                        : 'border-[#E5E5E4] bg-white hover:border-[#D97757]'
                    }`}
                  >
                    <div className="text-[13px] font-medium text-[#1F1F1F]">
                      {result.document_name}
                    </div>
                    <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-[#666666]">
                      {result.text}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4">
              <div className="rounded-[20px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#999999]">
                  命中详情
                </div>
                {selectedSearchResult ? (
                  <>
                    <div className="mt-3 text-[13px] font-medium text-[#1F1F1F]">
                      {selectedSearchResult.document_name}
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#E5E5E4] bg-white px-4 py-4 text-sm leading-relaxed text-[#666666]">
                      {selectedSearchResult.text}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        type="primary"
                        onClick={() =>
                          onOpenSearchResult(
                            {
                              query: state.query,
                              results: state.results,
                              tokens: state.tokens,
                              createdAt: Date.now()
                            },
                            selectedSearchIndex
                          )
                        }
                      >
                        打开文档
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {state.kind === 'document_view' ? (
          <div className="flex h-full flex-col gap-4" data-testid={workbenchSelectors.documentView}>
            <div className="rounded-[20px] border border-[#E5E5E4] bg-[#FCFBF8] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-[#1F1F1F]">
                    {state.file.fileName}
                  </div>
                  <div className="mt-1 break-all text-xs text-[#999999]">{state.file.path}</div>
                </div>
                {state.file.reviewId ? (
                  <Button onClick={() => onOpenReview(state.file.reviewId || '')}>查看差异</Button>
                ) : null}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <EmbeddedFileViewer
                filePath={state.file.path}
                fileName={state.file.fileName}
                pageNumber={state.file.pageNumber}
              />
            </div>
          </div>
        ) : null}

        {state.kind === 'review_session' ? (
          <WorkbenchReviewPanel
            review={state.review || null}
            loading={draftReviewLoading}
            validation={draftCommitValidation}
            validating={draftValidationLoading}
            busyChangeIds={draftDecisionBusyIds}
            bulkApplying={draftBulkApplying}
            committing={draftCommitSubmitting}
            turn={reviewTurn}
            onSetDecision={onSetDecision}
            onSetAllPending={onSetAllPending}
            onRefreshValidation={onRefreshValidation}
            onCommit={onCommit}
            onOpenFile={onOpenFile}
            onOpenPath={onOpenPath}
            onRevealPath={onRevealPath}
          />
        ) : null}
      </div>
    </aside>
  )
}

export default WorkbenchContentPanel
