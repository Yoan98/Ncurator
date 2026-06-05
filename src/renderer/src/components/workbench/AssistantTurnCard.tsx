import React, { useMemo } from 'react'
import { Tooltip } from 'antd'
import { HiChevronDown, HiOutlineDocumentText } from 'react-icons/hi2'
import MarkdownRenderer from '../MarkdownRenderer'
import { DOCX_APPLY_STATUS_META } from './constants'
import type {
  AssistantArtifactItem,
  AssistantProcessGroup,
  AssistantRichTextSegment,
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

const getProcessStatusClassName = (status: AssistantProcessGroup['status']): string => {
  if (status === 'running') return 'text-[#D97757]'
  if (status === 'failed') return 'text-[#B5455D]'
  return 'text-[#8A8884]'
}

const getGroupText = (group: AssistantProcessGroup): AssistantRichTextSegment[] => {
  if (group.status === 'completed') return group.completedText
  if (group.status === 'failed') return group.failedText
  return group.runningText
}

const getItemText = (item: AssistantProcessGroup['items'][number]): AssistantRichTextSegment[] => {
  if (item.status === 'completed') return item.completedText
  if (item.status === 'failed') return item.failedText
  return item.runningText
}

const renderSegments = (
  segments: AssistantRichTextSegment[],
  options?: { shimmer?: boolean }
): React.ReactNode => (
  <span className={options?.shimmer ? 'workbench-thinking-shimmer' : undefined}>
    {segments.map((segment, index) => (
      <span
        key={`${segment.text}-${index}`}
        className={segment.emphasis ? 'font-semibold text-[#2F2925]' : undefined}
      >
        {segment.text}
      </span>
    ))}
  </span>
)

const AssistantProcessGroupView: React.FC<{ group: AssistantProcessGroup }> = ({ group }) => {
  const isRunning = group.status === 'running'
  const groupText = getGroupText(group)
  return (
    <details
      className="group/process"
      open={isRunning || group.items.length === 0 ? true : undefined}
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${group.id}`}
    >
      <summary className="flex list-none items-start rounded-xl outline-none [&::-webkit-details-marker]:hidden">
        <span
          className={`inline-flex min-w-0 flex-1 items-center gap-1 text-[14px] leading-7 ${getProcessStatusClassName(group.status)}`}
        >
          <span className={isRunning ? 'font-medium' : undefined}>
            {renderSegments(groupText, { shimmer: isRunning })}
          </span>
          {group.items.length > 0 ? (
            <HiChevronDown className="mt-[1px] h-4 w-4 shrink-0 text-[#AAA6A0] transition-transform duration-200 group-open/process:rotate-180" />
          ) : null}
        </span>
      </summary>
      {group.items.length > 0 ? (
        <div className="mt-1.5 space-y-1.5 pl-4 text-[13px] leading-6 text-[#77736E]">
          {group.items.map((item) => (
            <div key={item.id} className={item.status === 'failed' ? 'text-[#B5455D]' : undefined}>
              {renderSegments(getItemText(item))}
            </div>
          ))}
        </div>
      ) : null}
    </details>
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
  const processGroups = useMemo(() => turn?.processGroups || [], [turn?.processGroups])
  const finalAnswerMarkdown = turn?.finalAnswerMarkdown || ''
  const hasFinalAnswer = finalAnswerMarkdown.trim().length > 0

  if (!turn) {
    return null
  }

  return (
    <div className="w-full" data-testid={`workbench-assistant-turn-${messageId}`}>
      <div className="space-y-4">
        {processGroups.length > 0 ? (
          <div
            className={`transition-opacity duration-200 ${
              turn.status === 'completed' && hasFinalAnswer ? 'opacity-75' : ''
            }`}
            data-testid={`${workbenchSelectors.assistantProcessPrefix}-${messageId}`}
          >
            <div className="space-y-2">
              {processGroups.map((group) => (
                <AssistantProcessGroupView key={group.id} group={group} />
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
