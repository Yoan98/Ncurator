import React, { useMemo, useState } from 'react'
import { Tooltip } from 'antd'
import {
  HiChevronDown,
  HiOutlineDocumentText,
  HiOutlineFolderOpen,
  HiSparkles
} from 'react-icons/hi2'
import { LoadingOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../MarkdownRenderer'
import { ASSISTANT_STEP_STATUS_META, REVIEW_STATUS_META } from './constants'
import type { AssistantTurnStep, AssistantTurnViewModel, WorkbenchFileRef } from './types'

type AssistantTurnCardProps = {
  messageId: string
  content: string
  turn?: AssistantTurnViewModel
  isStreaming?: boolean
  onOpenStep: (step: AssistantTurnStep) => void
  onOpenFile: (file: WorkbenchFileRef) => void
  onOpenReview: (reviewId: string) => void
}

const renderFileChip = (
  file: WorkbenchFileRef,
  onOpenFile: (file: WorkbenchFileRef) => void
): React.ReactNode => {
  return (
    <button
      key={`${file.origin}-${file.path}`}
      type="button"
      onClick={() => onOpenFile(file)}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#E5E5E4] bg-white px-3 py-1.5 text-left text-xs text-[#666666] transition-all duration-200 hover:-translate-y-[1px] hover:border-[#D97757] hover:text-[#D97757]"
    >
      <HiOutlineDocumentText className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{file.fileName}</span>
    </button>
  )
}

const AssistantTurnCard: React.FC<AssistantTurnCardProps> = ({
  messageId,
  content,
  turn,
  isStreaming,
  onOpenStep,
  onOpenFile,
  onOpenReview
}) => {
  const [expanded, setExpanded] = useState(false)

  const hasExecutionDetails = useMemo(() => {
    if (!turn) return false
    return (
      turn.steps.length > 0 ||
      turn.readFiles.length > 0 ||
      turn.editedFiles.length > 0 ||
      turn.reviewTargets.length > 0 ||
      turn.blockers.length > 0
    )
  }, [turn])

  return (
    <div className="flex gap-4" data-testid={`workbench-assistant-turn-${messageId}`}>
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]">
        <HiSparkles className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-[20px] rounded-bl-[10px] border border-[#EAE2DD] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <MarkdownRenderer content={content || (isStreaming ? '...' : '')} />
          {isStreaming && !content ? <LoadingOutlined className="mt-2 text-[#D97757]" /> : null}
        </div>

        {hasExecutionDetails ? (
          <div className="mt-2.5 overflow-hidden rounded-[18px] border border-[#E5E5E4] bg-[#FCFBF8]">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-white/70"
              onClick={() => setExpanded((previous) => !previous)}
              data-testid={`workbench-assistant-turn-steps-${messageId}`}
            >
              <div>
                <div className="text-[13px] font-medium text-[#1F1F1F]">执行过程</div>
                <div className="mt-1 text-[12px] text-[#666666]">
                  {turn?.steps.length || 0} 步 · 读取 {turn?.readFiles.length || 0} 个文件 · 修改{' '}
                  {turn?.editedFiles.length || 0} 个文件
                </div>
              </div>
              <HiChevronDown
                className={`h-4 w-4 text-[#999999] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>

            {expanded ? (
              <div className="space-y-4 border-t border-[#E5E5E4] px-4 py-4">
                {turn?.steps.length ? (
                  <div className="space-y-2">
                    {turn.steps.map((step) => {
                      const statusMeta = ASSISTANT_STEP_STATUS_META[step.status]
                      const interactive = step.files.length > 0
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => interactive && onOpenStep(step)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200 ${
                            interactive
                              ? 'border-[#E5E5E4] bg-white hover:-translate-y-[1px] hover:border-[#D97757]'
                              : 'border-[#E5E5E4] bg-white'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-[#1F1F1F]">
                                {step.summary}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="rounded-full border border-[#E5E5E4] bg-white px-2.5 py-1 text-[11px] text-[#666666]">
                                  {step.tool}
                                </span>
                                {step.files.map((file) => (
                                  <Tooltip key={`${step.id}-${file.path}`} title={file.path}>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-[#666666]">
                                      <HiOutlineFolderOpen className="h-3 w-3" />
                                      <span className="max-w-[180px] truncate">
                                        {file.fileName}
                                      </span>
                                    </span>
                                  </Tooltip>
                                ))}
                              </div>
                            </div>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] ${statusMeta.className}`}
                            >
                              {statusMeta.label}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {turn?.readFiles.length ? (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#999999]">
                      读取的文件
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {turn.readFiles.map((file) => renderFileChip(file, onOpenFile))}
                    </div>
                  </div>
                ) : null}

                {turn?.editedFiles.length ? (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#999999]">
                      修改的文件
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {turn.editedFiles.map((file) => renderFileChip(file, onOpenFile))}
                    </div>
                  </div>
                ) : null}

                {turn?.reviewTargets.length ? (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#999999]">
                      确认文档
                    </div>
                    <div className="space-y-2">
                      {turn.reviewTargets.map((review) => {
                        const statusMeta = review.status ? REVIEW_STATUS_META[review.status] : null
                        return (
                          <button
                            key={review.reviewId}
                            type="button"
                            onClick={() => onOpenReview(review.reviewId)}
                            data-testid={`workbench-assistant-turn-review-${review.reviewId}`}
                            className="w-full rounded-2xl border border-[#F4E5DF] bg-white px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[#D97757]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-[13px] font-medium text-[#1F1F1F]">
                                  {review.title}
                                </div>
                                <div className="mt-1 text-xs text-[#666666]">
                                  {review.documentCount} 个文档 · {review.changeCount} 处修改
                                </div>
                              </div>
                              {statusMeta ? (
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-[11px] ${statusMeta.className}`}
                                >
                                  {statusMeta.label}
                                </span>
                              ) : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {turn?.blockers.length ? (
                  <div className="space-y-2">
                    {turn.blockers.map((blocker) => (
                      <div
                        key={`${blocker.kind}-${blocker.title}`}
                        className="rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-4 py-3 text-sm text-[#8A6510]"
                      >
                        <div className="font-medium text-[#8A6510]">{blocker.title}</div>
                        <div className="mt-1 text-xs leading-relaxed text-[#8A6510]">
                          {blocker.description}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default AssistantTurnCard
