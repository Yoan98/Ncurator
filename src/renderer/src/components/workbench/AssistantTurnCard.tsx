import React, { useMemo } from 'react'
import { Tooltip } from 'antd'
import {
  HiChevronDown,
  HiCodeBracketSquare,
  HiDocumentText,
  HiMagnifyingGlass,
  HiMiniSparkles,
  HiOutlineDocumentText,
  HiPencilSquare,
  HiSparkles
} from 'react-icons/hi2'
import MarkdownRenderer from '../MarkdownRenderer'
import { DOCX_APPLY_STATUS_META } from './constants'
import type {
  AssistantArtifactItem,
  AssistantProcessIconKind,
  AssistantTurnViewModel
} from './types'
import { workbenchSelectors } from '../../testing/selectors'

type AssistantTurnCardProps = {
  messageId: string
  turn?: AssistantTurnViewModel
  isStreaming?: boolean
  onOpenFile: (file: AssistantArtifactItem) => void
  onOpenApply: (applyId: string) => void
}

const getProcessStatusClassName = (
  status: AssistantTurnViewModel['processItems'][number]['status']
): string => {
  if (status === 'active') return 'text-[#D97757]'
  if (status === 'failed') return 'text-[#B5455D]'
  return 'text-[#8A8884]'
}

const getProcessIcon = (iconKind: AssistantProcessIconKind): React.ReactNode => {
  if (iconKind === 'terminal') return <HiCodeBracketSquare className="h-4 w-4" />
  if (iconKind === 'edit') {
    return <HiPencilSquare className="h-4 w-4" />
  }
  if (iconKind === 'search' || iconKind === 'search-doc') {
    return <HiMagnifyingGlass className="h-4 w-4" />
  }
  if (iconKind === 'document') {
    return <HiDocumentText className="h-4 w-4" />
  }
  if (iconKind === 'learning') return <HiMiniSparkles className="h-4 w-4" />
  if (iconKind === 'mouth') return <HiSparkles className="h-4 w-4" />
  if (iconKind === 'compaction') return <HiSparkles className="h-4 w-4" />
  return <HiSparkles className="h-4 w-4" />
}

const AssistantProcessText: React.FC<{ item: AssistantTurnViewModel['processItems'][number] }> = ({
  item
}) => {
  const flow = item.isCurrent
  return (
    <div
      className={`group text-[14px] leading-7 ${getProcessStatusClassName(item.status)}`}
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${item.id}`}
    >
      <details className="group/details">
        <summary
          className={`flex list-none items-start gap-2.5 rounded-xl outline-none [&::-webkit-details-marker]:hidden ${
            item.details.length > 0 ? 'cursor-pointer' : 'cursor-default'
          }`}
          onClick={(event) => {
            if (item.details.length === 0) event.preventDefault()
          }}
        >
          {item.isCurrent ? (
            <span
              className={`mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full ${
                item.status === 'failed' ? 'bg-[#B5455D]' : 'bg-[#D97757]'
              }`}
            />
          ) : (
            <span className="w-1.5 shrink-0" />
          )}
          <span
            className={`mt-[3px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              flow ? 'bg-[#FBF5F2] text-[#D97757]' : 'bg-transparent text-[#A8A6A1]'
            }`}
          >
            {getProcessIcon(item.iconKind)}
          </span>
          <span
            className={`inline-flex items-center gap-1 ${
              flow
                ? 'workbench-thinking-shimmer font-medium'
                : item.status === 'completed'
                  ? 'text-[#8A8884]'
                  : 'font-medium'
            }`}
          >
            <span>{item.text}</span>
            {item.details.length > 0 ? (
              <HiChevronDown className="mt-[1px] h-4 w-4 shrink-0 text-[#AAA6A0] transition-transform duration-200 group-open/details:rotate-180" />
            ) : null}
          </span>
          {item.details.length > 0 ? <span className="sr-only">展开详情</span> : null}
        </summary>
        {item.details.length > 0 ? (
          <div className="ml-[48px] mt-1.5 space-y-1 rounded-xl bg-[#FAFAF9] px-3 py-2 text-[12px] leading-5 text-[#666666]">
            {item.details.map((detail) => (
              <div key={`${detail.label}-${detail.value}`} className="flex gap-2">
                <span className="shrink-0 text-[#999999]">{detail.label}</span>
                <span className="min-w-0 break-words text-[#555555]">{detail.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </details>
    </div>
  )
}

const renderArtifactChip = (
  file: AssistantArtifactItem,
  onOpenFile: (file: AssistantArtifactItem) => void
): React.ReactNode => (
  <Tooltip key={`${file.origin}-${file.path}-${file.applyId || ''}`} title={file.path}>
    <button
      type="button"
      onClick={() => onOpenFile(file)}
      className="ui-hover-lift inline-flex max-w-full items-center gap-2 rounded-full border border-[#E5E5E4] bg-white px-3 py-1.5 text-left text-xs text-[#666666] hover:border-[#D97757] hover:text-[#D97757]"
    >
      <HiOutlineDocumentText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{file.fileName}</span>
    </button>
  </Tooltip>
)

const AssistantTurnCard: React.FC<AssistantTurnCardProps> = ({
  messageId,
  turn,
  onOpenFile,
  onOpenApply
}) => {
  const processItems = useMemo(() => turn?.processItems || [], [turn?.processItems])
  const finalAnswerMarkdown = turn?.finalAnswerMarkdown || ''
  const hasFinalAnswer = finalAnswerMarkdown.trim().length > 0

  if (!turn) {
    return null
  }

  return (
    <div className="w-full" data-testid={`workbench-assistant-turn-${messageId}`}>
      <div className="space-y-4">
        {processItems.length > 0 ? (
          <div
            className={`transition-opacity duration-200 ${
              turn.status === 'completed' && hasFinalAnswer ? 'opacity-75' : ''
            }`}
            data-testid={`${workbenchSelectors.assistantProcessPrefix}-${messageId}`}
          >
            <div className="space-y-1.5">
              {processItems.map((item) => (
                <AssistantProcessText key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : null}

        {hasFinalAnswer ? (
          <div
            className="min-w-0 text-[15px] leading-7 text-[#1F1F1F]"
            data-testid={`${workbenchSelectors.assistantFinalAnswerPrefix}-${messageId}`}
          >
            <MarkdownRenderer content={finalAnswerMarkdown} />
          </div>
        ) : null}

        {!hasFinalAnswer && turn.status === 'failed' && turn.error ? (
          <div className="rounded-[18px] border border-[#F7D5D9] bg-[#FFF2F4] px-4 py-3 text-sm leading-6 text-[#B5455D]">
            {turn.error}
          </div>
        ) : null}

        {turn.applyTargets.length > 0 ? (
          <div className="rounded-[18px] border border-[#F4E5DF] bg-[#FBF5F2] px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#B98572]">
              修改的文件
            </div>
            <div className="space-y-2">
              {turn.applyTargets.map((apply) => {
                const statusMeta = apply.status ? DOCX_APPLY_STATUS_META[apply.status] : null
                return (
                  <button
                    key={apply.applyId}
                    type="button"
                    onClick={() => onOpenApply(apply.applyId)}
                    data-testid={`${workbenchSelectors.assistantTurnApplyPrefix}-${apply.applyId}`}
                    className="w-full rounded-2xl border border-[#F4E5DF] bg-white px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[#D97757]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[13px] font-medium text-[#1F1F1F]">{apply.title}</div>
                        <div className="mt-1 text-xs text-[#666666]">
                          {apply.changeCount} 处修改
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

        {turn.artifacts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {turn.artifacts.map((file) => renderArtifactChip(file, onOpenFile))}
          </div>
        ) : null}

        {turn.blockers.length > 0 ? (
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
    </div>
  )
}

export default AssistantTurnCard
