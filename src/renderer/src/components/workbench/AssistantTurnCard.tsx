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
import type {
  AssistantArtifactItem,
  AssistantProcessGroup,
  AssistantProcessIconKind,
  AssistantProcessThought,
  AssistantRichTextSegment,
  AssistantTurnViewModel
} from './types'
import type { WorkspaceSource } from '../../../../shared/types'
import type { ParsedNcuratorRefKind, ParsedNcuratorRefResourceType } from '../markdownReference'
import { workbenchSelectors } from '../../testing/selectors'
import { buildAssistantExecutionSummaryText, resolveAssistantExecutionStatus } from './utils'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspacePathLabel from './WorkspacePathLabel'

type AssistantTurnCardProps = {
  messageId: string
  turn?: AssistantTurnViewModel
  isStreaming?: boolean
  onOpenFile: (file: AssistantArtifactItem) => void
  onOpenApply: (changeId: string) => void
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  onOpenReference: (reference: {
    kind: ParsedNcuratorRefKind
    resourceType: ParsedNcuratorRefResourceType
    label: string
    path: string
  }) => void
}

const getProcessStatusClassName = (status: AssistantProcessGroup['status']): string => {
  if (status === 'running') return 'text-[#37352F]'
  if (status === 'failed' || status === 'partial_failed') return 'text-[#B3261E]'
  return 'text-[#9B9A97]'
}

const getLayerIconClassName = (iconKind: AssistantProcessIconKind): string => {
  if (iconKind === 'learning') return 'text-[#787774]'
  if (iconKind === 'compaction') return 'text-[#787774]'
  if (iconKind === 'document') return 'text-[#787774]'
  if (iconKind === 'edit') return 'text-[#787774]'
  if (iconKind === 'search') return 'text-[#787774]'
  if (iconKind === 'terminal') return 'text-[#787774]'
  return 'text-[#9B9A97]'
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
  if (group.status === 'partial_failed') return group.partialFailedText
  return group.runningText
}

const getItemText = (item: AssistantProcessGroup['items'][number]): AssistantRichTextSegment[] => {
  if (item.status === 'completed') return item.completedText
  if (item.status === 'failed') return item.failedText
  if (item.status === 'partial_failed') return item.partialFailedText
  return item.runningText
}

const renderSegments = (
  segments: AssistantRichTextSegment[],
  options?: { shimmer?: boolean }
): React.ReactNode => (
  <span className={options?.shimmer ? 'workbench-thinking-shimmer' : undefined}>
    {segments.map((segment, index) => {
      const textClassName = segment.emphasis ? 'font-semibold text-[#37352F]' : ''
      if (!segment.iconKind) {
        return (
          <span key={`${segment.text}-${index}`} className={textClassName}>
            {segment.text}
          </span>
        )
      }
      return (
        <span
          key={`${segment.text}-${index}`}
          className={`inline-flex items-center gap-1 ${textClassName}`}
        >
          <LayerIcon iconKind={segment.iconKind} />
          {segment.text}
        </span>
      )
    })}
  </span>
)

const AssistantProcessThoughtView: React.FC<{ thought: AssistantProcessThought }> = ({
  thought
}) => (
  <div
    className="text-[14px] leading-7 text-[#37352F]"
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
        className={`flex list-none items-start rounded-[8px] outline-none [&::-webkit-details-marker]:hidden ${
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
            <HiChevronDown className="mt-[1px] h-4 w-4 shrink-0 text-[#9B9A97] transition-transform duration-200 group-open/process:rotate-180" />
          ) : null}
        </span>
      </summary>
      {group.items.length > 0 ? (
        <div className="mt-1.5 space-y-1.5 pl-4 text-[13px] leading-6 text-[#787774]">
          {group.items.map((item) => (
            <div
              key={item.id}
              className={
                item.status === 'failed' || item.status === 'partial_failed'
                  ? 'text-[#B3261E]'
                  : undefined
              }
            >
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
  const items = groups
    .flatMap((group) => group.items)
    .sort((left, right) => left.createdAt - right.createdAt)
  const summaryText = buildAssistantExecutionSummaryText(groups)
  return (
    <details
      className="group/execution"
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${id}`}
    >
      <summary
        className={`flex list-none items-start rounded-[8px] outline-none [&::-webkit-details-marker]:hidden ${
          items.length > 0 ? 'cursor-pointer' : ''
        }`}
      >
        <span
          className={`inline-flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-6 transition-colors duration-200 ${
            status === 'failed' || status === 'partial_failed'
              ? 'text-[#B3261E]'
              : isRunning
                ? 'text-[#37352F]'
                : 'text-[#9B9A97] group-hover/execution:text-[#37352F]'
          }`}
        >
          <span className={isRunning ? 'font-medium' : undefined}>
            {renderSegments(summaryText, { shimmer: isRunning })}
          </span>
          {items.length > 0 ? (
            <>
              <HiChevronRight className="mt-[1px] h-4 w-4 shrink-0 text-[#9B9A97] opacity-0 transition-all duration-200 group-hover/execution:opacity-100 group-open/execution:hidden" />
              <HiChevronDown className="mt-[1px] hidden h-4 w-4 shrink-0 text-[#9B9A97] transition-all duration-200 group-open/execution:block" />
            </>
          ) : null}
        </span>
      </summary>
      {items.length > 0 ? (
        <div className="mt-1.5 space-y-1.5 pl-4 text-[13px] leading-6 text-[#787774]">
          {items.map((item) => (
            <div
              key={item.id}
              className={
                item.status === 'failed' || item.status === 'partial_failed'
                  ? 'text-[#B3261E]'
                  : undefined
              }
            >
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
): React.ReactNode => {
  const testIdSuffix = (file.applyId || file.path).replace(/[^a-zA-Z0-9_-]/g, '-')
  return (
    <Tooltip key={`${file.origin}-${file.path}-${file.applyId || ''}`} title={file.path}>
      <button
        type="button"
        onClick={() => onOpenFile(file)}
        data-testid={`${workbenchSelectors.assistantTurnArtifactPrefix}-${testIdSuffix}`}
        className="ui-hover-lift inline-flex max-w-full items-center gap-2 rounded-full border border-[#EEEEEC] bg-white px-3 py-1.5 text-left text-xs text-[#787774] hover:border-[#37352F] hover:text-[#37352F]"
      >
        <HiOutlineDocumentText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{file.fileName}</span>
      </button>
    </Tooltip>
  )
}

const AssistantTurnCard: React.FC<AssistantTurnCardProps> = ({
  messageId,
  turn,
  onOpenFile,
  onOpenApply,
  workspaces,
  fallbackWorkspaceName,
  onOpenReference
}) => {
  const processGroups = useMemo(() => turn?.processGroups || [], [turn?.processGroups])
  const processThoughts = useMemo(() => turn?.processThoughts || [], [turn?.processThoughts])
  const finalAnswerMarkdown = turn?.finalAnswerMarkdown || ''
  const hasFinalAnswer = finalAnswerMarkdown.trim().length > 0
  const visibleArtifacts = useMemo(() => {
    if (!turn) return []
    const applyIds = new Set(turn.applyTargets.map((target) => target.changeId))
    const applyPaths = new Set(
      turn.applyTargets
        .map((target) => target.sourcePath)
        .filter((path): path is string => Boolean(path))
    )
    return turn.artifacts.filter(
      (file) => !(file.applyId && applyIds.has(file.applyId)) && !applyPaths.has(file.path)
    )
  }, [turn])
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
            className="min-w-0 text-[15px] leading-7 text-[#37352F]"
            data-testid={`${workbenchSelectors.assistantFinalAnswerPrefix}-${messageId}`}
          >
            <MarkdownRenderer content={finalAnswerMarkdown} onOpenReference={onOpenReference} />
          </div>
        ) : null}

        {!hasFinalAnswer && turn.status === 'failed' && turn.error ? (
          <div className="rounded-[8px] border border-[#E7CAC6] bg-[#F8EBE9] px-4 py-3 text-sm leading-6 text-[#B3261E]">
            {turn.error}
          </div>
        ) : null}

        {turn.applyTargets.length > 0 ? (
          <div className="overflow-hidden rounded-[8px] border border-[#E5E4E0] bg-white">
            <div className="flex items-center gap-3 border-b border-[#EEEEEC] px-3.5 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#F4F4F2] text-[#787774]">
                <HiOutlineDocumentText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[#37352F]">修改的文件</div>
                <div className="mt-0.5 text-xs text-[#787774]">点击文件查看本次修改</div>
              </div>
              <div className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-[#37352F]">
                {turn.applyTargets.length} 个
              </div>
            </div>
            <div>
              {turn.applyTargets.map((apply) => {
                const statusLabel =
                  apply.status === 'reverted'
                    ? apply.operation === 'created'
                      ? '已删除'
                      : '已回退'
                    : apply.status === 'failed'
                      ? '失败'
                      : null
                return (
                  <button
                    key={apply.changeId}
                    type="button"
                    onClick={() => onOpenApply(apply.changeId)}
                    data-testid={`${workbenchSelectors.assistantTurnApplyPrefix}-${apply.changeId}`}
                    className="w-full border-b border-[#F1F0ED] px-3.5 py-2.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-[#F7F7F5]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <WorkspacePathLabel
                          filePath={apply.sourcePath || apply.title}
                          workspaces={workspaces}
                          fallbackWorkspaceName={fallbackWorkspaceName}
                          className="text-[13px] font-medium"
                          fileNameClassName="text-[#37352F]"
                          prefixClassName="text-[#9B9A97]"
                        />
                      </div>
                      <span className="flex shrink-0 items-center gap-1 pt-0.5">
                        <ChangeCountBadges
                          insertCount={apply.insertCount}
                          deleteCount={apply.deleteCount}
                        />
                        {statusLabel ? (
                          <span className="inline-flex h-5 items-center rounded-[4px] bg-[#F4F4F2] px-1.5 text-[11px] font-medium text-[#787774]">
                            {statusLabel}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {visibleArtifacts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {visibleArtifacts.map((file) => renderArtifactChip(file, onOpenFile))}
          </div>
        ) : null}

        {turn.blockers.length > 0 ? (
          <div className="space-y-2">
            {turn.blockers.map((blocker) => (
              <div
                key={`${blocker.kind}-${blocker.title}`}
                className="rounded-[8px] border border-[#EEEEEC] bg-[#F7F7F5] px-4 py-3 text-sm text-[#787774]"
              >
                <div className="font-medium text-[#787774]">{blocker.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-[#787774]">
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

export default React.memo(AssistantTurnCard)
