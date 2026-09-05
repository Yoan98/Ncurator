import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FiCheckCircle } from 'react-icons/fi'
import { MdOutlineSmsFailed } from 'react-icons/md'
import { RiForbidLine } from 'react-icons/ri'
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
import {
  findApprovalReviewForProcessItem,
  formatApprovalReviewRevealText,
  type AssistantApprovalReview
} from '../../../../shared/workbench/approvalReview'
import { workbenchSelectors } from '../../testing/selectors'
import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  resolveAssistantExecutionStatus,
  shouldShowAssistantApplyTargets,
  isAssistantActivityToolGroup
} from './utils'
import {
  shouldActivityHeaderShimmer,
  shouldShowAssistantThinkingIndicator
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
}) => {
  const [expanded, setExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const checkOverflow = useCallback(() => {
    const text = thought.text || ''
    if (text.includes('\n')) {
      setIsOverflowing(true)
      return
    }

    const el = contentRef.current
    if (!el) return

    if (!expanded) {
      setIsOverflowing(el.scrollWidth > el.clientWidth + 1)
    }
  }, [thought.text, expanded])

  useLayoutEffect(() => {
    checkOverflow()
  }, [checkOverflow])

  useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      checkOverflow()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [checkOverflow])

  const canExpand = isOverflowing

  return (
    <div
      className={`group/thought relative flex items-start justify-between gap-2 rounded-[6px] transition-colors duration-150 ${
        expanded
          ? 'bg-[#F7F7F5] px-2 py-1.5 -mx-2 cursor-pointer'
          : canExpand
            ? 'px-2 py-0.5 -mx-2 hover:bg-[#F7F7F5] cursor-pointer'
            : 'px-2 py-0.5 -mx-2 cursor-default'
      }`}
      onClick={(e) => {
        if (!canExpand) return
        if ((e.target as HTMLElement).closest('a, button')) return
        const selection = window.getSelection()
        if (selection && selection.toString().length > 0) return
        setExpanded((prev) => !prev)
      }}
      data-testid={workbenchSelectors.assistantThoughts}
    >
      <div
        ref={contentRef}
        className={`min-w-0 flex-1 text-[13.5px] leading-[22px] text-[#787774] ${
          expanded
            ? 'max-h-[320px] overflow-y-auto pr-1'
            : 'assistant-thought-collapsed'
        }`}
      >
        <MarkdownRenderer content={thought.text} variant="thought" />
      </div>
      {canExpand ? (
        <button
          type="button"
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[#9B9A97] transition-all duration-150 hover:text-[#37352F] ${
            expanded
              ? 'opacity-100'
              : 'opacity-0 group-hover/thought:opacity-100'
          }`}
          aria-label={expanded ? '收起思考内容' : '展开思考内容'}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((prev) => !prev)
          }}
        >
          {expanded ? (
            <HiChevronDown className="h-3.5 w-3.5" />
          ) : (
            <HiChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
    </div>
  )
}

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
            <HiChevronDown className="h-4 w-4 shrink-0 text-[#9B9A97] transition-transform duration-200 group-open/process:rotate-180" />
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
      waitingApproval?: boolean
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
  waitingApproval: boolean
  messageId: string
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

  if (!input.waitingApproval) return timeline

  const last = timeline[timeline.length - 1]
  if (last?.kind === 'activity') {
    last.waitingApproval = true
    return timeline
  }

  timeline.push({
    kind: 'activity',
    id: `${input.messageId}:approval-wait`,
    createdAt: Date.now(),
    groups: [],
    waitingApproval: true
  })
  return timeline
}

const WAITING_APPROVAL_SUMMARY: AssistantRichTextSegment[] = [{ text: '等待用户审核中' }]

const ApprovalReviewIcon: React.FC<{ action: AssistantApprovalReview['action'] }> = ({
  action
}) => {
  if (action === 'approve') {
    return <FiCheckCircle className="h-4 w-4 shrink-0 text-[#2F6F4E]" aria-hidden />
  }
  if (action === 'reject') {
    return <RiForbidLine className="h-4 w-4 shrink-0 text-[#B3261E]" aria-hidden />
  }
  return <MdOutlineSmsFailed className="h-4 w-4 shrink-0 text-[#B45309]" aria-hidden />
}

const AssistantActivityItemView: React.FC<{
  item: AssistantProcessGroup['items'][number]
  review?: AssistantApprovalReview
}> = ({ item, review }) => {
  const [revealing, setRevealing] = useState(false)
  const failed = item.status === 'failed' || item.status === 'partial_failed'
  const toolText = getItemText(item)
  const revealText = review ? formatApprovalReviewRevealText(review) : ''

  if (!review) {
    return (
      <div className={failed ? 'text-[#B3261E]' : undefined}>{renderSegments(toolText)}</div>
    )
  }

  return (
    <div
      data-testid={workbenchSelectors.assistantApprovalReviewedItem}
      className={`flex min-w-0 items-center gap-1.5 leading-[22px] ${failed ? 'text-[#B3261E]' : ''}`}
    >
      <span
        className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-[4px] transition-colors duration-150 hover:bg-[#EFEFEE]"
        onMouseEnter={() => setRevealing(true)}
        onMouseLeave={() => setRevealing(false)}
      >
        <ApprovalReviewIcon action={review.action} />
      </span>
      <span className="relative min-w-0 flex-1 overflow-hidden">
        <span
          className={`block truncate transition-all duration-150 ${
            revealing
              ? 'pointer-events-none translate-x-1 opacity-0'
              : 'translate-x-0 opacity-100'
          }`}
        >
          {renderSegments(toolText)}
        </span>
        <span
          className={`absolute inset-0 flex items-center truncate text-[#787774] transition-all duration-150 ${
            revealing ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0'
          }`}
        >
          {revealText}
        </span>
      </span>
    </div>
  )
}

const AssistantActivityGroupView: React.FC<{
  groups: AssistantProcessGroup[]
  id: string
  shimmerActive: boolean
  waitingApproval?: boolean
  approvalReviews?: readonly AssistantApprovalReview[]
}> = ({ groups, id, shimmerActive, waitingApproval = false, approvalReviews = [] }) => {
  const status = resolveAssistantExecutionStatus(groups)
  const items = groups
    .flatMap((group) => group.items)
    .sort((left, right) => left.createdAt - right.createdAt)
  const summaryText = waitingApproval
    ? WAITING_APPROVAL_SUMMARY
    : buildAssistantExecutionSummaryText(
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
  const iconKind = waitingApproval ? 'terminal' : resolveAssistantExecutionIcon(groups)
  const headerShimmer = waitingApproval || shimmerActive
  return (
    <details
      className="group/execution"
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${id}`}
      data-approval-waiting={waitingApproval ? 'true' : undefined}
    >
      <summary
        className={`flex list-none items-start rounded-[8px] outline-none [&::-webkit-details-marker]:hidden ${
          items.length > 0 ? 'cursor-pointer' : ''
        }`}
        data-testid={waitingApproval ? workbenchSelectors.assistantApprovalWaiting : undefined}
      >
        <span
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-[13px] leading-6 transition-colors duration-200 ${
            !waitingApproval && (status === 'failed' || status === 'partial_failed')
              ? 'text-[#B3261E]'
              : headerShimmer
                ? 'text-[#37352F]'
                : 'text-[#9B9A97] group-hover/execution:text-[#37352F]'
          }`}
        >
          <LayerIcon iconKind={iconKind} />
          <span className={`min-w-0 truncate ${headerShimmer ? 'font-medium' : ''}`}>
            {renderSegments(summaryText, { shimmer: headerShimmer })}
          </span>
          {items.length > 0 ? (
            <>
              <HiChevronRight className="h-4 w-4 shrink-0 text-[#9B9A97] opacity-0 transition-all duration-200 group-hover/execution:opacity-100 group-open/execution:hidden" />
              <HiChevronDown className="hidden h-4 w-4 shrink-0 text-[#9B9A97] transition-all duration-200 group-open/execution:block" />
            </>
          ) : null}
        </span>
      </summary>
      {items.length > 0 ? (
        <div className="mt-1 space-y-0.5 pl-5 text-[13px] leading-[22px] text-[#787774]">
          {items.map((item) => (
            <AssistantActivityItemView
              key={item.id}
              item={item}
              review={findApprovalReviewForProcessItem({
                itemId: item.id,
                toolName: item.toolName,
                itemInput: item.input,
                reviews: approvalReviews
              })}
            />
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
  const hasNextAiContentForActivity =
    hasFinalAnswer ||
    hasStreamingThought ||
    turn?.status === 'completed' ||
    turn?.status === 'failed'
  const showThinkingIndicator = shouldShowAssistantThinkingIndicator({
    isBrainThinking: turn?.isBrainThinking,
    waitingApproval: Boolean(turn?.waitingApproval),
    runFinished: Boolean(turn?.runFinished),
    hasFinalAnswer
  })
  const processGroups = useMemo(
    () => (turn?.processGroups || []).filter((group) => group.kind !== 'thinking'),
    [turn?.processGroups]
  )
  const timeline = useMemo(
    () =>
      buildAssistantTimeline({
        thoughts: processThoughts,
        groups: processGroups,
        waitingApproval: Boolean(turn?.waitingApproval),
        messageId
      }),
    [messageId, processGroups, processThoughts, turn?.waitingApproval]
  )
  const approvalReviews = turn?.approvalReviews || []
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
        {timeline.length > 0 || hasStreamingThought || showThinkingIndicator ? (
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
                      waitingApproval={entry.waitingApproval}
                      approvalReviews={approvalReviews}
                      shimmerActive={
                        Boolean(entry.waitingApproval) ||
                        shouldActivityHeaderShimmer({
                          activityCreatedAt: entry.createdAt,
                          thoughts: processThoughts,
                          hasNextAiContent: hasNextAiContentForActivity
                        })
                      }
                    />
                  )
                }
                return <AssistantProcessGroupView key={entry.id} group={entry.group} />
              })}
              {streamingRole === 'thought' && streamingMarkdown.trim() ? (
                <div className="min-w-0 max-h-[320px] overflow-y-auto rounded-[6px] bg-[#F7F7F5] px-2 py-1.5 -mx-2 pr-1 text-[13.5px] leading-[22px] text-[#787774]">
                  <MarkdownRenderer content={streamingMarkdown} variant="thought" />
                </div>
              ) : null}
              {showThinkingIndicator ? (
                <div
                  className="flex items-center gap-1.5 text-[13px] leading-6 text-[#787774]"
                  data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${messageId}-thinking`}
                >
                  <span className="workbench-thinking-shimmer font-medium text-[#37352F]">
                    偷偷思考中
                  </span>
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
      </div>
    </div>
  )
}

export default React.memo(AssistantTurnCard)
