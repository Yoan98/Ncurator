import React, { useMemo } from 'react'
import { Tooltip } from 'antd'
import {
  HiChevronDown,
  HiChevronRight,
  HiOutlineAcademicCap,
  HiOutlineArchiveBox,
  HiOutlineCommandLine,
  HiOutlineDocumentText,
  HiOutlineMagnifyingGlass,
  HiOutlinePencilSquare
} from 'react-icons/hi2'
import MarkdownRenderer from '../MarkdownRenderer'
import { FILE_CHANGE_STATUS_META } from './constants'
import type {
  AssistantArtifactItem,
  AssistantProcessGroup,
  AssistantProcessIconKind,
  AssistantProcessThought,
  AssistantRichTextSegment,
  AssistantTurnViewModel
} from './types'
import type { ParsedNcuratorRefKind, ParsedNcuratorRefSourceType } from '../markdownReference'
import { workbenchSelectors } from '../../testing/selectors'
import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionStatus
} from './utils'

type AssistantTurnCardProps = {
  messageId: string
  turn?: AssistantTurnViewModel
  isStreaming?: boolean
  onOpenFile: (file: AssistantArtifactItem) => void
  onOpenApply: (changeId: string) => void
  onOpenReference: (reference: {
    kind: ParsedNcuratorRefKind
    sourceType: ParsedNcuratorRefSourceType
    label: string
    path: string
  }) => void
}

const getProcessStatusClassName = (status: AssistantProcessGroup['status']): string => {
  if (status === 'running') return 'text-[#181818]'
  if (status === 'failed') return 'text-[#A83A31]'
  return 'text-[#9C9A94]'
}

const getLayerIconClassName = (iconKind: AssistantProcessIconKind): string => {
  if (iconKind === 'learning') return 'text-[#6E6D69]'
  if (iconKind === 'compaction') return 'text-[#6E6D69]'
  if (iconKind === 'document') return 'text-[#6E6D69]'
  if (iconKind === 'edit') return 'text-[#6E6D69]'
  if (iconKind === 'search') return 'text-[#6E6D69]'
  if (iconKind === 'terminal') return 'text-[#6E6D69]'
  return 'text-[#9C9A94]'
}

const LayerIcon: React.FC<{ iconKind: AssistantProcessIconKind; className?: string }> = ({
  iconKind,
  className
}) => {
  const iconClassName = `h-4 w-4 shrink-0 ${getLayerIconClassName(iconKind)} ${className || ''}`
  if (iconKind === 'learning') return <HiOutlineAcademicCap className={iconClassName} />
  if (iconKind === 'compaction') return <HiOutlineArchiveBox className={iconClassName} />
  if (iconKind === 'document') return <HiOutlineDocumentText className={iconClassName} />
  if (iconKind === 'edit') return <HiOutlinePencilSquare className={iconClassName} />
  if (iconKind === 'search') return <HiOutlineMagnifyingGlass className={iconClassName} />
  if (iconKind === 'terminal') return <HiOutlineCommandLine className={iconClassName} />
  return <HiOutlineDocumentText className={iconClassName} />
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
        className={`inline-flex items-center gap-1 ${segment.emphasis ? 'font-semibold text-[#181818]' : ''}`}
      >
        {segment.iconKind ? <LayerIcon iconKind={segment.iconKind} /> : null}
        {segment.text}
      </span>
    ))}
  </span>
)

const AssistantProcessThoughtView: React.FC<{ thought: AssistantProcessThought }> = ({
  thought
}) => (
  <div
    className="text-[14px] leading-7 text-[#181818]"
    data-testid={workbenchSelectors.assistantThoughts}
  >
    {thought.text}
  </div>
)

const AssistantProcessGroupView: React.FC<{ group: AssistantProcessGroup }> = ({ group }) => {
  const isRunning = group.status === 'running'
  const groupText = getGroupText(group)
  const shouldShowIcon = group.kind === 'learning' || group.kind === 'compaction'
  return (
    <details
      className="group/process"
      open={group.items.length === 0 ? true : undefined}
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${group.id}`}
    >
      <summary
        className={`flex list-none items-start rounded-xl outline-none [&::-webkit-details-marker]:hidden ${
          group.items.length > 0 ? 'cursor-pointer' : ''
        }`}
      >
        <span
          className={`inline-flex min-w-0 flex-1 items-center gap-1 text-[14px] leading-7 ${getProcessStatusClassName(group.status)}`}
        >
          {shouldShowIcon ? <LayerIcon iconKind={group.iconKind} /> : null}
          <span className={isRunning ? 'font-medium' : undefined}>
            {renderSegments(groupText, { shimmer: isRunning })}
          </span>
          {group.items.length > 0 ? (
            <HiChevronDown className="mt-[1px] h-4 w-4 shrink-0 text-[#9C9A94] transition-transform duration-200 group-open/process:rotate-180" />
          ) : null}
        </span>
      </summary>
      {group.items.length > 0 ? (
        <div className="mt-1.5 space-y-1.5 pl-4 text-[13px] leading-6 text-[#6E6D69]">
          {group.items.map((item) => (
            <div key={item.id} className={item.status === 'failed' ? 'text-[#A83A31]' : undefined}>
              {renderSegments(getItemText(item))}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  )
}

type AssistantTimelineEntry =
  | {
      kind: 'decision'
      id: string
      createdAt: number
      thought: AssistantProcessThought
    }
  | {
      kind: 'execution'
      id: string
      createdAt: number
      groups: AssistantProcessGroup[]
    }
  | {
      kind: 'group'
      id: string
      createdAt: number
      group: AssistantProcessGroup
    }

type RawTimelineEntry =
  | {
      kind: 'decision'
      id: string
      createdAt: number
      thought: AssistantProcessThought
    }
  | {
      kind: 'group'
      id: string
      createdAt: number
      group: AssistantProcessGroup
    }

const buildAssistantTimeline = (input: {
  thoughts: AssistantProcessThought[]
  groups: AssistantProcessGroup[]
  hasFinalAnswer: boolean
}): AssistantTimelineEntry[] => {
  const rawEntries: RawTimelineEntry[] = [
    ...input.thoughts.map((thought) => ({
      kind: 'decision' as const,
      id: thought.id,
      createdAt: thought.createdAt,
      thought
    })),
    ...input.groups
      .filter((group) => !(input.hasFinalAnswer && group.kind === 'finalizing'))
      .map((group) => ({
        kind: 'group' as const,
        id: group.id,
        createdAt: group.createdAt,
        group
      }))
  ].sort((left, right) => left.createdAt - right.createdAt)

  const timeline: AssistantTimelineEntry[] = []
  for (const entry of rawEntries) {
    if (
      entry.kind !== 'group' ||
      entry.group.kind !== 'skill' ||
      entry.group.sourceEventType === 'thinking'
    ) {
      timeline.push(entry)
      continue
    }
    const last = timeline[timeline.length - 1]
    if (last?.kind === 'execution') {
      last.groups.push(entry.group)
      continue
    }
    timeline.push({
      kind: 'execution',
      id: entry.group.id,
      createdAt: entry.createdAt,
      groups: [entry.group]
    })
  }
  return timeline
}

const AssistantExecutionGroupView: React.FC<{ groups: AssistantProcessGroup[]; id: string }> = ({
  groups,
  id
}) => {
  const status = resolveAssistantExecutionStatus(groups)
  const isRunning = status === 'running'
  const items = groups.flatMap((group) => group.items).sort((left, right) => left.createdAt - right.createdAt)
  const summaryText = buildAssistantExecutionSummaryText(groups)
  return (
    <details
      className="group/execution"
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${id}`}
    >
      <summary
        className={`flex list-none items-start rounded-xl outline-none [&::-webkit-details-marker]:hidden ${
          items.length > 0 ? 'cursor-pointer' : ''
        }`}
      >
        <span
          className={`inline-flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-6 transition-colors duration-200 ${
            status === 'failed'
              ? 'text-[#A83A31]'
              : isRunning
                ? 'text-[#181818]'
                : 'text-[#9C9A94] group-hover/execution:text-[#181818]'
          }`}
        >
          <span className={isRunning ? 'font-medium' : undefined}>
            {renderSegments(summaryText, { shimmer: isRunning })}
          </span>
          {items.length > 0 ? (
            <>
              <HiChevronRight className="mt-[1px] h-4 w-4 shrink-0 text-[#9C9A94] opacity-0 transition-all duration-200 group-hover/execution:opacity-100 group-open/execution:hidden" />
              <HiChevronDown className="mt-[1px] hidden h-4 w-4 shrink-0 text-[#9C9A94] transition-all duration-200 group-open/execution:block" />
            </>
          ) : null}
        </span>
      </summary>
      {items.length > 0 ? (
        <div className="mt-1.5 space-y-1.5 pl-4 text-[13px] leading-6 text-[#6E6D69]">
          {items.map((item) => (
            <div key={item.id} className={item.status === 'failed' ? 'text-[#A83A31]' : undefined}>
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
      className="ui-hover-lift inline-flex max-w-full items-center gap-2 rounded-full border border-[#E1DED6] bg-white px-3 py-1.5 text-left text-xs text-[#6E6D69] hover:border-[#181818] hover:text-[#181818]"
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
  onOpenApply,
  onOpenReference
}) => {
  const processGroups = useMemo(() => turn?.processGroups || [], [turn?.processGroups])
  const processThoughts = useMemo(() => turn?.processThoughts || [], [turn?.processThoughts])
  const finalAnswerMarkdown = turn?.finalAnswerMarkdown || ''
  const hasFinalAnswer = finalAnswerMarkdown.trim().length > 0
  const timeline = useMemo(
    () =>
      buildAssistantTimeline({
        thoughts: processThoughts,
        groups: processGroups,
        hasFinalAnswer
      }),
    [hasFinalAnswer, processGroups, processThoughts]
  )

  if (!turn) {
    return null
  }

  return (
    <div className="w-full" data-testid={`workbench-assistant-turn-${messageId}`}>
      <div className="space-y-4">
        {timeline.length > 0 ? (
          <div
            className={`transition-opacity duration-200 ${
              turn.status === 'completed' && hasFinalAnswer ? 'opacity-75' : ''
            }`}
            data-testid={`${workbenchSelectors.assistantProcessPrefix}-${messageId}`}
          >
            <div className="space-y-3">
              {timeline.map((entry) => {
                if (entry.kind === 'decision') {
                  return <AssistantProcessThoughtView key={entry.id} thought={entry.thought} />
                }
                if (entry.kind === 'execution') {
                  return (
                    <AssistantExecutionGroupView
                      key={entry.id}
                      id={entry.id}
                      groups={entry.groups}
                    />
                  )
                }
                return <AssistantProcessGroupView key={entry.id} group={entry.group} />
              })}
            </div>
          </div>
        ) : null}

        {hasFinalAnswer ? (
          <div
            className="min-w-0 text-[15px] leading-7 text-[#181818]"
            data-testid={`${workbenchSelectors.assistantFinalAnswerPrefix}-${messageId}`}
          >
            <MarkdownRenderer content={finalAnswerMarkdown} onOpenReference={onOpenReference} />
          </div>
        ) : null}

        {!hasFinalAnswer && turn.status === 'failed' && turn.error ? (
          <div className="rounded-[18px] border border-[#D9C6C2] bg-[#F7F1EF] px-4 py-3 text-sm leading-6 text-[#A83A31]">
            {turn.error}
          </div>
        ) : null}

        {turn.applyTargets.length > 0 ? (
          <div className="rounded-[18px] border border-[#E1DED6] bg-[#F0EFEB] px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#6E6D69]">
              修改的文件
            </div>
            <div className="space-y-2">
              {turn.applyTargets.map((apply) => {
                const statusMeta = apply.status ? FILE_CHANGE_STATUS_META[apply.status] : null
                return (
                  <button
                    key={apply.changeId}
                    type="button"
                    onClick={() => onOpenApply(apply.changeId)}
                    data-testid={`${workbenchSelectors.assistantTurnApplyPrefix}-${apply.changeId}`}
                    className="w-full rounded-2xl border border-[#E1DED6] bg-white px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[#181818]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[13px] font-medium text-[#181818]">{apply.title}</div>
                        <div className="mt-1 text-xs text-[#6E6D69]">
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
                className="rounded-2xl border border-[#E1DED6] bg-[#FAF9F5] px-4 py-3 text-sm text-[#6E6D69]"
              >
                <div className="font-medium text-[#6E6D69]">{blocker.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-[#6E6D69]">
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
