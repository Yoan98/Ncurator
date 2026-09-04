import React, { useMemo, useState } from 'react'
import {
  HiChevronDown,
  HiChevronRight,
  HiArrowPath,
  HiOutlineAcademicCap,
  HiOutlineArchiveBox,
  HiOutlineBolt,
  HiOutlineBookOpen,
  HiOutlineCommandLine,
  HiOutlineCursorArrowRays,
  HiOutlineDocumentText,
  HiOutlineGlobeAlt,
  HiOutlineMagnifyingGlass,
  HiOutlinePhoto,
  HiOutlinePencilSquare
} from 'react-icons/hi2'
import MarkdownRenderer from '../MarkdownRenderer'
import type {
  AssistantProcessGroup,
  AssistantProcessIconKind,
  AssistantProcessThought,
  AssistantRichTextSegment,
  AssistantTurnViewModel
} from './types'
import type { WorkspaceSource } from '../../../../shared/types'
import type { OpenableMarkdownReference } from '../markdownReference'
import { workbenchSelectors } from '../../testing/selectors'
import {
  buildAssistantExecutionSummaryText,
  createAssistantThinkingGroup,
  resolveAssistantExecutionIcon,
  resolveAssistantExecutionStatus,
  shouldShowAssistantApplyTargets,
  visibleAssistantProcessGroups,
  isAssistantActivityToolGroup
} from './utils'
import {
  shouldActivityHeaderShimmer,
  shouldShowAssistantThinkingWait
} from '../../../../shared/assistantThinkingWait'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspacePathLabel from './WorkspacePathLabel'

type AssistantTurnCardProps = {
  messageId: string
  turn?: AssistantTurnViewModel
  isStreaming?: boolean
  onOpenApply: (changeId: string) => void
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  onOpenReference: (reference: OpenableMarkdownReference) => void
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
  if (iconKind === 'browser') return 'text-[#787774]'
  if (iconKind === 'web') return 'text-[#787774]'
  if (iconKind === 'image') return 'text-[#787774]'
  if (iconKind === 'knowledge') return 'text-[#787774]'
  if (iconKind === 'workflow') return 'text-[#787774]'
  if (iconKind === 'terminal') return 'text-[#787774]'
  if (iconKind === 'retry') return 'text-[#787774]'
  return 'text-[#9B9A97]'
}

const LayerIcon: React.FC<{ iconKind: AssistantProcessIconKind; className?: string }> = ({
  iconKind,
  className
}) => {
  const iconClassName = `h-4 w-4 shrink-0 ${getLayerIconClassName(iconKind)} ${className || ''}`
  const iconProps = { className: iconClassName, 'data-process-icon-kind': iconKind }
  if (iconKind === 'learning') return <HiOutlineAcademicCap {...iconProps} />
  if (iconKind === 'compaction') return <HiOutlineArchiveBox {...iconProps} />
  if (iconKind === 'document') return <HiOutlineDocumentText {...iconProps} />
  if (iconKind === 'edit') return <HiOutlinePencilSquare {...iconProps} />
  if (iconKind === 'search') return <HiOutlineMagnifyingGlass {...iconProps} />
  if (iconKind === 'browser') return <HiOutlineCursorArrowRays {...iconProps} />
  if (iconKind === 'web') return <HiOutlineGlobeAlt {...iconProps} />
  if (iconKind === 'image') return <HiOutlinePhoto {...iconProps} />
  if (iconKind === 'knowledge') return <HiOutlineBookOpen {...iconProps} />
  if (iconKind === 'workflow') return <HiOutlineBolt {...iconProps} />
  if (iconKind === 'terminal') return <HiOutlineCommandLine {...iconProps} />
  if (iconKind === 'retry') return <HiArrowPath {...iconProps} />
  return <HiOutlineDocumentText {...iconProps} />
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
      const textClassName = segment.emphasis ? 'text-[#37352F]' : ''
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
    <MarkdownRenderer content={thought.text} variant="thought" />
  </div>
)

const AssistantProcessGroupView: React.FC<{ group: AssistantProcessGroup }> = ({ group }) => {
  const isRunning = group.status === 'running'
  const groupText = getGroupText(group)
  const shouldShowIcon = group.kind === 'compaction' || group.kind === 'retry'
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
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-[14px] leading-7 ${getProcessStatusClassName(group.status)}`}
        >
          {shouldShowIcon ? <LayerIcon iconKind={group.iconKind} /> : null}
          <span className={`min-w-0 truncate ${isRunning ? 'font-medium' : ''}`}>
            {renderSegments(groupText, { shimmer: isRunning })}
          </span>
          {group.items.length > 0 ? (
            <HiChevronDown className="mt-[1px] h-4 w-4 shrink-0 text-[#9B9A97] transition-transform duration-200 group-open/process:rotate-180" />
          ) : null}
        </span>
      </summary>
      {group.items.length > 0 ? (
        <div className="mt-1 space-y-0.5 pl-5 text-[13px] leading-[22px] text-[#787774]">
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
      kind: 'activity'
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

const isActivityToolGroup = isAssistantActivityToolGroup

const buildAssistantTimeline = (input: {
  thoughts: AssistantProcessThought[]
  groups: AssistantProcessGroup[]
}): AssistantTimelineEntry[] => {
  const rawEntries: RawTimelineEntry[] = [
    ...input.thoughts.map((thought) => ({
      kind: 'decision' as const,
      id: thought.id,
      createdAt: thought.createdAt,
      thought
    })),
    ...input.groups
      .filter((group) => group.kind !== 'finalizing' && group.kind !== 'learning')
      .map((group) => ({
        kind: 'group' as const,
        id: group.id,
        createdAt: group.createdAt,
        group
      }))
  ].sort((left, right) => left.createdAt - right.createdAt)

  const timeline: AssistantTimelineEntry[] = []
  for (const entry of rawEntries) {
    if (entry.kind === 'decision' || !isActivityToolGroup(entry.group)) {
      timeline.push(entry)
      continue
    }
    const last = timeline[timeline.length - 1]
    if (last?.kind === 'activity') {
      last.groups.push(entry.group)
      continue
    }
    timeline.push({
      kind: 'activity',
      id: entry.group.id,
      createdAt: entry.createdAt,
      groups: [entry.group]
    })
  }
  return timeline
}

const AssistantActivityGroupView: React.FC<{
  groups: AssistantProcessGroup[]
  id: string
  shimmerActive: boolean
}> = ({ groups, id, shimmerActive }) => {
  const status = resolveAssistantExecutionStatus(groups)
  const items = groups
    .flatMap((group) => group.items)
    .sort((left, right) => left.createdAt - right.createdAt)
  const summaryText = buildAssistantExecutionSummaryText(
    groups.map((group) => ({
      id: group.id,
      skillKey: group.skillKey,
      status: group.status,
      items: group.items.map((item) => ({
        toolName: item.toolName,
        targetLabel: item.targetLabel,
        input: item.input,
        status: item.status,
        runningText: item.runningText,
        completedText: item.completedText,
        failedText: item.failedText,
        partialFailedText: item.partialFailedText,
        headerShortText: item.headerShortText
      }))
    }))
  )
  const iconKind = resolveAssistantExecutionIcon(groups)
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
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-[13px] leading-6 transition-colors duration-200 ${
            status === 'failed' || status === 'partial_failed'
              ? 'text-[#B3261E]'
              : shimmerActive
                ? 'text-[#37352F]'
                : 'text-[#9B9A97] group-hover/execution:text-[#37352F]'
          }`}
        >
          <LayerIcon iconKind={iconKind} />
          <span className={`min-w-0 truncate ${shimmerActive ? 'font-medium' : ''}`}>
            {renderSegments(summaryText, { shimmer: shimmerActive })}
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
        <div className="mt-1 space-y-0.5 pl-5 text-[13px] leading-[22px] text-[#787774]">
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

const MAX_VISIBLE_APPLY_TARGETS = 3

const AssistantTurnCard: React.FC<AssistantTurnCardProps> = ({
  messageId,
  turn,
  onOpenApply,
  workspaces,
  fallbackWorkspaceName,
  onOpenReference
}) => {
  const [applyTargetsExpanded, setApplyTargetsExpanded] = useState(false)
  const processThoughts = useMemo(() => turn?.processThoughts || [], [turn?.processThoughts])
  const finalAnswerMarkdown = turn?.finalAnswerMarkdown || ''
  const streamingMarkdown = turn?.streamingMarkdown || ''
  const streamingRole = turn?.streamingRole || 'answer'
  const visibleAnswerMarkdown =
    finalAnswerMarkdown || (streamingRole === 'answer' ? streamingMarkdown : '')
  const hasFinalAnswer = visibleAnswerMarkdown.trim().length > 0
  const hasStreamingThought = streamingRole === 'thought' && streamingMarkdown.trim().length > 0
  // Only treat settled/visible brain text as output — bare streaming buffer before classify
  // must not suppress the wait placeholder.
  const hasVisibleBrainOutput = hasFinalAnswer || hasStreamingThought
  const hasNextAiContentForActivity =
    hasFinalAnswer ||
    hasStreamingThought ||
    turn?.status === 'completed' ||
    turn?.status === 'failed'
  const showThinkingWait = shouldShowAssistantThinkingWait({
    processGroups: turn?.processGroups || [],
    processThoughts,
    hasVisibleBrainOutput
  })
  const processGroups = useMemo(() => {
    const visible = visibleAssistantProcessGroups({
      processGroups: turn?.processGroups || [],
      processThoughts,
      hasVisibleBrainOutput
    })
    if (!showThinkingWait) return visible
    if (visible.some((group) => group.kind === 'thinking' && group.status === 'running')) {
      return visible
    }
    const lastCreatedAt = Math.max(
      0,
      ...processThoughts.map((thought) => thought.createdAt),
      ...visible.map((group) => group.createdAt)
    )
    return [
      ...visible.filter((group) => group.kind !== 'thinking'),
      {
        ...createAssistantThinkingGroup(messageId),
        createdAt: lastCreatedAt + 1
      }
    ]
  }, [hasVisibleBrainOutput, messageId, processThoughts, showThinkingWait, turn?.processGroups])
  const timeline = useMemo(
    () =>
      buildAssistantTimeline({
        thoughts: processThoughts,
        groups: processGroups
      }),
    [processGroups, processThoughts]
  )
  const applyTargets = turn?.applyTargets || []
  const applyTargetsCollapsed =
    applyTargets.length > MAX_VISIBLE_APPLY_TARGETS && !applyTargetsExpanded
  const visibleApplyTargets = applyTargetsCollapsed
    ? applyTargets.slice(0, MAX_VISIBLE_APPLY_TARGETS)
    : applyTargets

  if (!turn) {
    return null
  }

  return (
    <div className="w-full" data-testid={`workbench-assistant-turn-${messageId}`}>
      <div className="space-y-4">
        {timeline.length > 0 || hasStreamingThought || showThinkingWait ? (
          <div
            className={`transition-opacity duration-200 ${
              turn.status === 'completed' && hasFinalAnswer ? 'opacity-75' : ''
            }`}
            data-testid={`${workbenchSelectors.assistantProcessPrefix}-${messageId}`}
          >
            <div className="space-y-2">
              {timeline.map((entry) => {
                if (entry.kind === 'decision') {
                  return <AssistantProcessThoughtView key={entry.id} thought={entry.thought} />
                }
                if (entry.kind === 'activity') {
                  return (
                    <AssistantActivityGroupView
                      key={entry.id}
                      id={entry.id}
                      groups={entry.groups}
                      shimmerActive={shouldActivityHeaderShimmer({
                        activityCreatedAt: entry.createdAt,
                        thoughts: processThoughts,
                        hasNextAiContent: hasNextAiContentForActivity
                      })}
                    />
                  )
                }
                return <AssistantProcessGroupView key={entry.id} group={entry.group} />
              })}
              {streamingRole === 'thought' && streamingMarkdown.trim() ? (
                <div className="text-[14px] leading-7 text-[#37352F]">
                  <MarkdownRenderer content={streamingMarkdown} variant="thought" />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {hasFinalAnswer ? (
          <div
            className="min-w-0 text-[15px] leading-7 text-[#37352F]"
            data-testid={`${workbenchSelectors.assistantFinalAnswerPrefix}-${messageId}`}
          >
            <MarkdownRenderer
              content={visibleAnswerMarkdown}
              linkAccess={turn.linkAccess}
              onOpenReference={onOpenReference}
            />
          </div>
        ) : null}

        {turn.status === 'failed' && turn.error ? (
          <div className="rounded-[8px] border border-[#E7CAC6] bg-[#F8EBE9] px-4 py-3 text-sm leading-6 text-[#B3261E]">
            {turn.error}
          </div>
        ) : null}

        {shouldShowAssistantApplyTargets({
          runFinished: turn.runFinished,
          applyTargetCount: turn.applyTargets.length
        }) ? (
          <div className="overflow-hidden rounded-[8px] border border-[#E5E4E0] bg-white">
            <div className="flex items-center gap-3 border-b border-[#EEEEEC] px-3.5 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#F4F4F2] text-[#787774]">
                <HiOutlineDocumentText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[#37352F]">修改的文件</div>
                <div className="mt-0.5 text-xs text-[#787774]">点击文件查看本次修改</div>
              </div>
              <div
                className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-[#37352F]"
                data-testid={`${workbenchSelectors.assistantTurnApplyCountPrefix}-${messageId}`}
              >
                {turn.applyTargets.length} 个
              </div>
            </div>
            <div>
              {visibleApplyTargets.map((apply) => {
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
                          separator="/"
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
            {turn.applyTargets.length > MAX_VISIBLE_APPLY_TARGETS ? (
              <button
                type="button"
                onClick={() => setApplyTargetsExpanded((value) => !value)}
                aria-expanded={applyTargetsExpanded}
                data-testid={`${workbenchSelectors.assistantTurnApplyCollapsePrefix}-${messageId}`}
                className="flex w-full items-center gap-1.5 border-t border-[#F1F0ED] px-3.5 py-2 text-left text-xs font-medium text-[#787774] transition-colors duration-200 hover:bg-[#F7F7F5] hover:text-[#37352F]"
              >
                <HiChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                    applyTargetsExpanded ? 'rotate-180' : ''
                  }`}
                />
                {applyTargetsExpanded
                  ? '收起文件'
                  : `显示剩余 ${turn.applyTargets.length - MAX_VISIBLE_APPLY_TARGETS} 个文件`}
              </button>
            ) : null}
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
