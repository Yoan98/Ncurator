import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from 'antd'
import PartnerAvatar from './PartnerAvatar'
import { PARTNER_AVATAR_SHAPES, PARTNER_AVATAR_COLORS } from '../../../../shared/types'
import { FaSpider } from 'react-icons/fa'
import { PiBrowsers, PiEyes } from 'react-icons/pi'
import { TbMoodConfuzed } from 'react-icons/tb'
import {
  HiChevronDown,
  HiChevronRight,
  HiArrowPath,
  HiOutlineAcademicCap,
  HiOutlineArchiveBox,
  HiOutlineArrowsUpDown,
  HiOutlineBolt,
  HiOutlineBookOpen,
  HiOutlineCamera,
  HiOutlineCommandLine,
  HiOutlineCursorArrowRays,
  HiOutlineDocumentText,
  HiOutlineEye,
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
  AssistantTurnViewModel,
  SubagentTaskView
} from './types'
import type { WorkspaceSource } from '../../../../shared/types'
import type { OpenableMarkdownReference } from '../markdownReference'
import {
  findApprovalReviewForProcessItem,
  type AssistantApprovalReview
} from '../../../../shared/workbench/approvalReview'
import { workbenchSelectors } from '../../testing/selectors'
import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  resolveQuestionInteraction,
  shouldShowAssistantApplyTargets,
  isAssistantActivityToolGroup
} from './utils'
import {
  shouldActivityHeaderShimmer,
  shouldShowAssistantThinkingIndicator
} from '../../../../shared/assistantThinkingWait'
import ChangeCountBadges from './ChangeCountBadges'
import WorkspacePathLabel from './WorkspacePathLabel'
import ReadImageThumbs from './ReadImageThumbs'
import { readImagePathsFromInput } from '../../../../shared/workbench/readImageThumbUtils'
import type { ImageLightboxImage } from './ImageLightbox'

type AssistantTurnCardProps = {
  messageId: string
  turn?: AssistantTurnViewModel
  isStreaming?: boolean
  onOpenApply: (changeId: string) => void
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  onOpenReference: (reference: OpenableMarkdownReference) => void
  onPreviewImage?: (image: ImageLightboxImage) => void
}

const getProcessStatusClassName = (status: AssistantProcessGroup['status']): string => {
  if (status === 'running') return 'text-[#37352F]'
  if (status === 'failed' || status === 'partial_failed') return 'text-[#B3261E]'
  return 'text-[#37352F]'
}

const getLayerIconClassName = (iconKind: AssistantProcessIconKind): string => {
  if (iconKind === 'default') return 'text-[#9B9A97]'
  return 'text-[#787774]'
}

const LayerIcon: React.FC<{ iconKind: AssistantProcessIconKind; className?: string }> = ({
  iconKind,
  className
}) => {
  // CommandLine 光学中心偏上，单独微下调与同行文字对齐
  const iconClassName = `block h-4 w-4 ${
    iconKind === 'terminal' ? 'translate-y-[0.5px] ' : ''
  }${getLayerIconClassName(iconKind)} ${className || ''}`
  const iconProps = { className: iconClassName, 'data-process-icon-kind': iconKind }
  const icon =
    iconKind === 'learning' ? (
      <HiOutlineAcademicCap {...iconProps} />
    ) : iconKind === 'compaction' ? (
      <HiOutlineArchiveBox {...iconProps} />
    ) : iconKind === 'document' ? (
      <HiOutlineDocumentText {...iconProps} />
    ) : iconKind === 'edit' ? (
      <HiOutlinePencilSquare {...iconProps} />
    ) : iconKind === 'search' ? (
      <HiOutlineMagnifyingGlass {...iconProps} />
    ) : iconKind === 'browser' ? (
      <HiOutlineCursorArrowRays {...iconProps} />
    ) : iconKind === 'web' ? (
      <HiOutlineGlobeAlt {...iconProps} />
    ) : iconKind === 'image' ? (
      <HiOutlinePhoto {...iconProps} />
    ) : iconKind === 'knowledge' ? (
      <HiOutlineBookOpen {...iconProps} />
    ) : iconKind === 'workflow' ? (
      <HiOutlineBolt {...iconProps} />
    ) : iconKind === 'terminal' ? (
      <HiOutlineCommandLine {...iconProps} />
    ) : iconKind === 'retry' ? (
      <HiArrowPath {...iconProps} />
    ) : iconKind === 'eye' ? (
      <HiOutlineEye {...iconProps} />
    ) : iconKind === 'camera' ? (
      <HiOutlineCamera {...iconProps} />
    ) : iconKind === 'scroll' ? (
      <HiOutlineArrowsUpDown {...iconProps} />
    ) : iconKind === 'extract' ? (
      <PiEyes {...iconProps} />
    ) : iconKind === 'window' ? (
      <PiBrowsers {...iconProps} />
    ) : iconKind === 'fetch' ? (
      <FaSpider {...iconProps} />
    ) : iconKind === 'question' ? (
      <TbMoodConfuzed {...iconProps} />
    ) : (
      <HiOutlineDocumentText {...iconProps} />
    )
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
      {icon}
    </span>
  )
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

const getActivityItemText = (
  item: AssistantProcessGroup['items'][number]
): AssistantRichTextSegment[] => {
  if (item.toolName !== 'terminal_run' || !item.terminalReviewState) return getItemText(item)
  const prefix = {
    reviewing: '正在审核命令 ',
    ready_to_execute: '审核通过，准备执行命令 ',
    waiting_approval: '待你确认命令 ',
    not_executed: '命令未执行 '
  }[item.terminalReviewState]
  const commandSegments = item.runningText.slice(1)
  return [
    { text: prefix },
    ...(commandSegments.length > 0 ? commandSegments : [{ text: '终端命令' }])
  ]
}

const formatRunDuration = (startedAt: number, finishedAt: number): string => {
  const elapsedSeconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return minutes > 0 ? `${minutes}分钟${seconds}秒` : `${seconds}秒`
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

const AssistantProcessThoughtView: React.FC<{
  thought: AssistantProcessThought
  onOpenReference?: (reference: OpenableMarkdownReference) => void
}> = ({ thought, onOpenReference }) => {
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
      className={`group/thought relative flex justify-between gap-2 rounded-[6px] transition-colors duration-150 ${
        expanded
          ? 'items-start bg-[#F7F7F5] px-2 py-1.5 -mx-2 cursor-pointer'
          : canExpand
            ? 'items-center px-2 py-0.5 -mx-2 hover:bg-[#F7F7F5] cursor-pointer'
            : 'items-center px-2 py-0.5 -mx-2 cursor-default'
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
        className={`min-w-0 flex-1 text-[13.5px] leading-[22px] text-[#37352F] ${
          expanded ? 'max-h-[320px] overflow-y-auto pr-1' : 'assistant-thought-collapsed'
        }`}
      >
        <MarkdownRenderer
          content={thought.text}
          variant="thought"
          onOpenReference={onOpenReference}
        />
      </div>
      {canExpand ? (
        <button
          type="button"
          className={`flex h-[22px] w-4 shrink-0 items-center justify-center rounded-[3px] text-[#9B9A97] transition-all duration-150 hover:text-[#37352F] ${
            expanded ? 'opacity-100' : 'opacity-0 group-hover/thought:opacity-100'
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

const subagentAvatar = (runId: string) => {
  let seed = 2166136261
  for (const character of runId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  seed >>>= 0
  return {
    shape: PARTNER_AVATAR_SHAPES[seed % PARTNER_AVATAR_SHAPES.length],
    color: PARTNER_AVATAR_COLORS[(seed >>> 8) % PARTNER_AVATAR_COLORS.length]
  }
}

const SubagentThought: React.FC<{ child: SubagentTaskView; open: boolean }> = ({ child, open }) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const active = child.status === 'running'
  const text =
    child.status === 'queued'
      ? '我在排队'
      : active
        ? child.message || ''
        : child.result ||
          {
            completed: '任务已完成',
            failed: '执行失败',
            cancelled: '已停止',
            blocked: '需要主伙伴继续处理',
            interrupted: '执行被中断，未收到完整结果'
          }[child.status]
  const requesting = active && child.requesting
  useLayoutEffect(() => {
    if (!open || !contentRef.current) return
    const content = contentRef.current
    const scrollToLatest = (): void => {
      content.scrollTop = content.scrollHeight
    }
    scrollToLatest()
    const frame = requestAnimationFrame(scrollToLatest)
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [open, text, requesting])
  return (
    <div data-testid="subagent-thought" className="nc-subagent-thought-cloud">
      <svg
        className="nc-subagent-thought-outline"
        viewBox="0 0 264 110"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M30 94C9 94 1 74 11 60C0 45 10 25 30 24C36 5 60 2 74 14C86 0 109 0 120 13C139 0 161 5 169 18C189 6 210 15 214 28C240 22 259 38 254 57C270 74 254 97 232 96C220 111 195 108 184 98C166 112 143 109 131 99C113 112 89 107 81 97C65 111 42 107 30 94Z" />
      </svg>
      <div ref={contentRef} className="nc-subagent-thought-lines">
        <span data-testid="subagent-message">{requesting ? text.trimEnd() : text}</span>
        {requesting ? (
          <span
            data-testid="subagent-stream-dot"
            className="nc-subagent-stream-dot"
            aria-label="正在请求模型"
          />
        ) : null}
      </div>
    </div>
  )
}

const SubagentTaskRow: React.FC<{ child: SubagentTaskView }> = ({ child }) => {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      placement="topLeft"
      trigger={['hover', 'focus']}
      arrow={false}
      color="transparent"
      overlayClassName="nc-subagent-thought-tooltip"
      mouseEnterDelay={0.15}
      onOpenChange={setOpen}
      title={<SubagentThought child={child} open={open} />}
    >
      <button
        type="button"
        data-testid="subagent-task"
        data-child-run-id={child.childRunId}
        data-status={child.status}
        aria-label={child.name}
        className={`flex items-center gap-1.5 rounded-lg py-1 pr-1 text-left text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-[#9B9A97] ${child.status === 'queued' ? 'text-[#9B9A97]' : 'text-[#37352F]'}`}
      >
        <span className={child.status === 'queued' ? 'grayscale opacity-40' : undefined}>
          <PartnerAvatar
            {...subagentAvatar(child.childRunId)}
            size={32}
            animated={child.status === 'running'}
            animationSeed={child.childRunId}
          />
        </span>
        <span className="max-w-[8em] truncate">{child.name}</span>
      </button>
    </Tooltip>
  )
}

const SubagentGroupView: React.FC<{ group: AssistantProcessGroup }> = ({ group }) => (
  <div data-testid="subagent-group" className="flex flex-col items-start gap-1 py-1">
    {(group.subagents || []).map((child) => (
      <SubagentTaskRow key={child.childRunId} child={child} />
    ))}
  </div>
)

const AssistantProcessGroupView: React.FC<{ group: AssistantProcessGroup }> = ({ group }) => {
  if (group.subagents?.length) return <SubagentGroupView group={group} />
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
        <div className="mt-1 space-y-0.5 pl-5 text-[13px] leading-[22px] text-[#37352F]">
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
      waitingInteraction?: boolean
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
  waitingInteraction: boolean
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
    if (
      entry.kind === 'decision' ||
      entry.group.subagents?.length ||
      !isActivityToolGroup(entry.group)
    ) {
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

  if (!(input.waitingApproval || input.waitingInteraction)) return timeline

  const last = timeline[timeline.length - 1]
  if (last?.kind === 'activity') {
    last.waitingApproval = input.waitingApproval || Boolean(last.waitingApproval)
    last.waitingInteraction = input.waitingInteraction || Boolean(last.waitingInteraction)
    return timeline
  }

  timeline.push({
    kind: 'activity',
    id: `${input.messageId}:approval-wait`,
    createdAt: Date.now(),
    groups: [],
    waitingApproval: input.waitingApproval,
    waitingInteraction: input.waitingInteraction
  })
  return timeline
}

const WAITING_APPROVAL_SUMMARY: AssistantRichTextSegment[] = [{ text: '等待用户处理' }]
const WAITING_INTERACTION_SUMMARY: AssistantRichTextSegment[] = [{ text: '等待用户处理' }]

const AssistantActivityItemView: React.FC<{
  item: AssistantProcessGroup['items'][number]
  review?: AssistantApprovalReview
  onPreviewImage?: (image: ImageLightboxImage) => void
}> = ({ item, review, onPreviewImage }) => {
  const failed =
    (item.status === 'failed' || item.status === 'partial_failed') &&
    item.terminalReviewState !== 'not_executed'
  const interaction = resolveQuestionInteraction(item)
  const toolText = getActivityItemText(item)
  const readImagePaths = item.toolName === 'read_image' ? readImagePathsFromInput(item.input) : []
  const hasReviewResult = Boolean(review || item.terminalReviewDecision)
  const thumbs =
    readImagePaths.length > 0 ? (
      <ReadImageThumbs paths={readImagePaths} onPreviewImage={onPreviewImage} />
    ) : null

  if (!hasReviewResult) {
    return (
      <div
        data-process-item-id={item.id}
        data-process-item-status={item.status}
        data-terminal-review-state={item.terminalReviewState}
        className={failed ? 'text-[#B3261E]' : undefined}
      >
        {renderSegments(toolText)}
        {interaction ? <InteractionResultView interaction={interaction} /> : null}
        {thumbs}
      </div>
    )
  }

  return (
    <div
      data-testid={review ? workbenchSelectors.assistantApprovalReviewedItem : undefined}
      data-process-item-id={item.id}
      data-process-item-status={item.status}
      data-terminal-review-state={item.terminalReviewState}
      data-terminal-review-decision={item.terminalReviewDecision}
      className={failed ? 'text-[#B3261E]' : undefined}
    >
      <div className="min-w-0 leading-[22px]">{renderSegments(toolText)}</div>
      <div
        data-testid={workbenchSelectors.assistantReviewResultRail}
        className="mt-1 space-y-1 border-l border-[#E0DFDC] pl-3 text-xs text-[#787774]"
      >
        {item.terminalReviewDecision ? (
          <div data-review-actor="ai">
            AI 审核结果：
            {item.terminalReviewDecision === 'auto_approve' ? '已通过' : '需要人工确认'}
          </div>
        ) : null}
        {review ? (
          <div data-review-actor="human">
            人工审核结果：
            {review.action === 'approve'
              ? '已允许'
              : review.action === 'reject'
                ? '已拒绝'
                : `已提供指导${review.message ? `：${review.message}` : ''}`}
          </div>
        ) : null}
      </div>
      {thumbs}
    </div>
  )
}

const InteractionResultView: React.FC<{
  interaction: NonNullable<AssistantProcessGroup['items'][number]['interaction']>
}> = ({ interaction }) => (
  <div className="mt-1 space-y-1 border-l border-[#E0DFDC] pl-3 text-xs text-[#787774]">
    {interaction.questions.map((question) => {
      const answer = interaction.answers?.find((item) => item.questionId === question.id)
      const labels = question.options
        .filter((option) => answer?.selectedOptionIds.includes(option.id))
        .map((option) => option.label)
      if (answer?.userText) labels.push(answer.userText)
      return (
        <div key={question.id}>
          <div>{question.question}</div>
          <div className="text-[#37352F]">{labels.join('、') || '未填写'}</div>
        </div>
      )
    })}
  </div>
)

const AssistantActivityGroupView: React.FC<{
  groups: AssistantProcessGroup[]
  id: string
  shimmerActive: boolean
  waitingApproval?: boolean
  waitingInteraction?: boolean
  approvalReviews?: readonly AssistantApprovalReview[]
  onPreviewImage?: (image: ImageLightboxImage) => void
}> = ({
  groups,
  id,
  shimmerActive,
  waitingApproval = false,
  waitingInteraction = false,
  approvalReviews = [],
  onPreviewImage
}) => {
  const items = groups
    .flatMap((group) => group.items)
    .sort((left, right) => left.createdAt - right.createdAt)
  const reviewingCount = items.filter((item) => item.terminalReviewState === 'reviewing').length
  const onlyNotExecutedTerminalItems =
    items.length > 0 &&
    items.every(
      (item) => item.terminalReviewState === 'not_executed' && item.toolName === 'terminal_run'
    )
  const summaryGroups = groups
    .map((group) => ({
      id: group.id,
      skillKey: group.skillKey,
      status: group.status,
      items: group.items
        .filter((item) => item.terminalReviewState !== 'not_executed')
        .map((item) => ({
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
    .filter((group) => group.items.length > 0)
  const waitingUser = waitingApproval || waitingInteraction
  const summaryText = waitingApproval
    ? WAITING_APPROVAL_SUMMARY
    : waitingInteraction
      ? WAITING_INTERACTION_SUMMARY
      : reviewingCount > 0
        ? [
            {
              text:
                reviewingCount === 1 ? '正在审核终端命令' : `正在审核 ${reviewingCount} 条终端命令`
            }
          ]
        : onlyNotExecutedTerminalItems
          ? [{ text: '命令未执行' }]
          : buildAssistantExecutionSummaryText(summaryGroups)
  const iconKind =
    waitingUser || reviewingCount > 0 ? 'terminal' : resolveAssistantExecutionIcon(groups)
  const headerShimmer = waitingUser || reviewingCount > 0 || shimmerActive
  return (
    <details
      className="group/execution"
      data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${id}`}
      data-approval-waiting={waitingApproval ? 'true' : undefined}
      data-interaction-waiting={waitingInteraction ? 'true' : undefined}
      data-terminal-reviewing={reviewingCount > 0 ? 'true' : undefined}
    >
      <summary
        className={`flex list-none items-center rounded-[8px] outline-none [&::-webkit-details-marker]:hidden ${
          items.length > 0 ? 'cursor-pointer' : ''
        }`}
        data-testid={waitingApproval ? workbenchSelectors.assistantApprovalWaiting : undefined}
      >
        <span
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-[13px] leading-6 transition-colors duration-200 ${
            headerShimmer ? 'text-[#37352F]' : 'text-[#9B9A97] group-hover/execution:text-[#37352F]'
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
              onPreviewImage={onPreviewImage}
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
  onOpenReference,
  onPreviewImage
}) => {
  const [applyTargetsExpanded, setApplyTargetsExpanded] = useState(false)
  const [processExpanded, setProcessExpanded] = useState(() => !turn?.runFinished)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const wasRunFinishedRef = useRef(Boolean(turn?.runFinished))
  const processThoughts = useMemo(() => turn?.processThoughts || [], [turn?.processThoughts])
  const finalAnswerMarkdown = turn?.finalAnswerMarkdown || ''
  const streamingMarkdown = turn?.streamingMarkdown || ''
  const streamingRole = turn?.streamingRole || 'answer'
  const visibleAnswerMarkdown =
    finalAnswerMarkdown || (streamingRole === 'answer' ? streamingMarkdown : '')
  const hasFinalAnswer = visibleAnswerMarkdown.trim().length > 0
  const hasStreamingThought = streamingRole === 'thought' && streamingMarkdown.trim().length > 0
  const hasNextAiContentForActivity =
    hasFinalAnswer || hasStreamingThought || Boolean(turn?.runFinished)
  const processGroups = useMemo(
    () => (turn?.processGroups || []).filter((group) => group.kind !== 'thinking'),
    [turn?.processGroups]
  )
  const hasRunningRetry = processGroups.some(
    (group) => group.kind === 'retry' && group.status === 'running'
  )
  const showThinkingIndicator = shouldShowAssistantThinkingIndicator({
    isBrainThinking: turn?.isBrainThinking,
    waitingApproval: Boolean(turn?.waitingApproval || turn?.waitingInteraction),
    runFinished: Boolean(turn?.runFinished),
    hasFinalAnswer,
    hasRunningRetry
  })
  /** 运行未结束且尚无最终回答时预留固定行高，避免「让俺想想」显隐把页面顶抖 */
  const reserveThinkingSlot =
    showThinkingIndicator ||
    (!turn?.runFinished && !turn?.waitingApproval && !turn?.waitingInteraction && !hasFinalAnswer)
  const timeline = useMemo(
    () =>
      buildAssistantTimeline({
        thoughts: processThoughts,
        groups: processGroups,
        waitingApproval: Boolean(turn?.waitingApproval),
        waitingInteraction: Boolean(turn?.waitingInteraction),
        messageId
      }),
    [messageId, processGroups, processThoughts, turn?.waitingApproval, turn?.waitingInteraction]
  )
  const approvalReviews = turn?.approvalReviews || []
  const applyTargets = turn?.applyTargets || []
  const applyTargetsCollapsed =
    applyTargets.length > MAX_VISIBLE_APPLY_TARGETS && !applyTargetsExpanded
  const visibleApplyTargets = applyTargetsCollapsed
    ? applyTargets.slice(0, MAX_VISIBLE_APPLY_TARGETS)
    : applyTargets

  useEffect(() => {
    if (!turn?.startedAt || turn.runFinished) return
    setCurrentTime(Date.now())
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [turn?.runFinished, turn?.startedAt])

  useLayoutEffect(() => {
    const wasRunFinished = wasRunFinishedRef.current
    if (!wasRunFinished && turn?.runFinished) setProcessExpanded(false)
    wasRunFinishedRef.current = Boolean(turn?.runFinished)
  }, [turn?.runFinished])

  if (!turn) {
    return null
  }

  return (
    <div className="w-full" data-testid={`workbench-assistant-turn-${messageId}`}>
      <div className="space-y-4">
        {timeline.length > 0 || hasStreamingThought || reserveThinkingSlot || turn.startedAt ? (
          <div data-testid={`${workbenchSelectors.assistantProcessPrefix}-${messageId}`}>
            {turn.startedAt ? (
              turn.runFinished ? (
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-start gap-1.5 border-b border-[#EEEEEC] pb-2 text-left text-[14px] leading-6 text-[#37352F]"
                  aria-expanded={processExpanded}
                  aria-label={`${processExpanded ? '收起' : '展开'}过程记录`}
                  data-testid={`${workbenchSelectors.assistantProcessTogglePrefix}-${messageId}`}
                  onClick={() => setProcessExpanded((expanded) => !expanded)}
                >
                  <span
                    data-testid={`${workbenchSelectors.assistantRunDurationPrefix}-${messageId}`}
                  >
                    用时 {formatRunDuration(turn.startedAt, turn.finishedAt ?? currentTime)}
                  </span>
                  {processExpanded ? (
                    <HiChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <HiChevronRight className="h-4 w-4 shrink-0" />
                  )}
                </button>
              ) : (
                <div className="mb-2 flex items-center border-b border-[#EEEEEC] pb-2 text-[14px] leading-6 text-[#37352F]">
                  <span
                    data-testid={`${workbenchSelectors.assistantRunDurationPrefix}-${messageId}`}
                  >
                    已处理 {formatRunDuration(turn.startedAt, currentTime)}
                  </span>
                </div>
              )
            ) : null}
            <div className={processExpanded ? 'space-y-2' : 'hidden'}>
              {timeline.map((entry) => {
                if (entry.kind === 'decision') {
                  return (
                    <AssistantProcessThoughtView
                      key={entry.id}
                      thought={entry.thought}
                      onOpenReference={onOpenReference}
                    />
                  )
                }
                if (entry.kind === 'activity') {
                  return (
                    <AssistantActivityGroupView
                      key={entry.id}
                      id={entry.id}
                      groups={entry.groups}
                      waitingApproval={entry.waitingApproval}
                      waitingInteraction={entry.waitingInteraction}
                      approvalReviews={approvalReviews}
                      onPreviewImage={onPreviewImage}
                      shimmerActive={
                        Boolean(entry.waitingApproval || entry.waitingInteraction) ||
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
                <div className="min-w-0 px-2 py-0.5 -mx-2 text-[13.5px] leading-[22px] text-[#37352F]">
                  <MarkdownRenderer
                    content={streamingMarkdown}
                    variant="thought"
                    onOpenReference={onOpenReference}
                  />
                </div>
              ) : null}
              {reserveThinkingSlot ? (
                <div
                  className="flex h-6 items-center gap-1.5 text-[13px] leading-6 text-[#37352F]"
                  data-testid={`${workbenchSelectors.assistantProcessItemPrefix}-${messageId}-thinking`}
                  aria-hidden={!showThinkingIndicator}
                >
                  {showThinkingIndicator ? (
                    <span className="workbench-thinking-shimmer font-medium text-[#37352F]">
                      让俺想想
                    </span>
                  ) : null}
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
          <div
            className="rounded-[8px] border border-[#E7CAC6] bg-[#F8EBE9] px-4 py-3 text-sm leading-6 text-[#B3261E]"
            data-testid={`${workbenchSelectors.assistantRunFailurePrefix}-${messageId}`}
          >
            <div>失败：{turn.error}</div>
            {turn.errorDetail ? (
              <details className="mt-2">
                <summary
                  className="cursor-pointer select-none text-xs text-[#8A4F48] underline-offset-2 hover:underline"
                  data-testid={`${workbenchSelectors.assistantRunFailureDetailTogglePrefix}-${messageId}`}
                >
                  查看详情
                </summary>
                <pre
                  className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[#F3DDD9] px-3 py-2 text-xs leading-5 text-[#7A3B34]"
                  data-testid={`${workbenchSelectors.assistantRunFailureDetailPrefix}-${messageId}`}
                >
                  {turn.errorDetail}
                </pre>
              </details>
            ) : null}
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
