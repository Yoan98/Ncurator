import { localizeSystemText } from '../../i18n/systemText'
import { t } from '../../i18n'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import SubagentGroupView, { SubagentCloudProvider } from './SubagentGroupView'
import { presentSubagentGroups } from './subagentPresentation'
import { FaSpider, FaBook } from 'react-icons/fa'
import { PiBrowsers, PiEyes } from 'react-icons/pi'
import { TbMoodConfuzed } from 'react-icons/tb'
import {
  HiChevronDown,
  HiChevronRight,
  HiArrowPath,
  HiOutlineWrench,
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
  AssistantTurnViewModel
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
  isAssistantRunAlive,
  resolveAssistantLiveTailOwner,
  shouldActivityHeaderShimmer
} from '../../../../shared/assistantProcessLiveness'
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
  onOpenReference: (reference: OpenableMarkdownReference) => void
  onPreviewImage?: (image: ImageLightboxImage) => void
}

const getProcessStatusClassName = (status: AssistantProcessGroup['status']): string => {
  if (status === 'running') return 'text-[var(--notion-text)]'
  if (status === 'failed' || status === 'partial_failed') return 'text-[var(--notion-red)]'
  return 'text-[var(--notion-text)]'
}

const getLayerIconClassName = (iconKind: AssistantProcessIconKind): string => {
  if (iconKind === 'toolset_loading') return 'text-[var(--notion-blue)]'
  if (iconKind === 'skill_loading') return 'text-[var(--notion-purple)]'
  if (iconKind === 'default') return 'text-[var(--notion-text-faint)]'
  return 'text-[var(--notion-text-soft)]'
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
    iconKind === 'toolset_loading' ? (
      <HiOutlineWrench {...iconProps} />
    ) : iconKind === 'skill_loading' ? (
      <FaBook {...iconProps} />
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
    reviewing: t(($) => $.workbench.reviewingCommand),
    ready_to_execute: t(($) => $.workbench.approvedPreparingCommand),
    waiting_approval: t(($) => $.workbench.waitingForApprovalOfCommand),
    not_executed: t(($) => $.workbench.commandDidNotRun)
  }[item.terminalReviewState]
  const commandSegments = item.runningText.slice(1)
  return [
    { text: prefix },
    ...(commandSegments.length > 0
      ? commandSegments
      : [{ text: t(($) => $.workbench.terminalCommand) }])
  ]
}

const formatRunDuration = (startedAt: number, finishedAt: number): string => {
  const elapsedSeconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return minutes > 0
    ? t(($) => $.workbench.mS, { value1: minutes, value2: seconds })
    : t(($) => $.workbench.s, { value1: seconds })
}

const renderSegments = (
  segments: AssistantRichTextSegment[],
  options?: { shimmer?: boolean }
): React.ReactNode => (
  <span className={options?.shimmer ? 'workbench-thinking-shimmer' : undefined}>
    {segments.map((segment, index) => {
      const textClassName = segment.emphasis ? 'text-[var(--notion-text)]' : ''
      if (!segment.iconKind) {
        return (
          <span
            key={`${segment.param ? segment.text : localizeSystemText(segment.text)}-${index}`}
            className={textClassName}
          >
            {segment.param ? segment.text : localizeSystemText(segment.text)}
          </span>
        )
      }
      return (
        <span
          key={`${segment.param ? segment.text : localizeSystemText(segment.text)}-${index}`}
          className={`inline-flex items-center gap-1 ${textClassName}`}
        >
          <LayerIcon iconKind={segment.iconKind} />
          {segment.param ? segment.text : localizeSystemText(segment.text)}
        </span>
      )
    })}
  </span>
)

const AssistantProcessThoughtView: React.FC<{
  thought: AssistantProcessThought
  liveTail: boolean
  onOpenReference?: (reference: OpenableMarkdownReference) => void
}> = ({ thought, liveTail, onOpenReference }) => (
  <div
    className="min-w-0 px-2 py-0.5 -mx-2 text-[13.5px] leading-[22px] text-[var(--notion-text)]"
    data-testid={workbenchSelectors.assistantThoughts}
  >
    <MarkdownRenderer
      content={thought.text}
      variant="thought"
      liveTail={liveTail}
      onOpenReference={onOpenReference}
    />
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
            <HiChevronRight className="h-4 w-4 shrink-0 text-[var(--notion-text-faint)] transition-transform duration-200 group-open/process:rotate-90" />
          ) : null}
        </span>
      </summary>
      {group.items.length > 0 ? (
        <div className="mt-1 space-y-0.5 pl-5 text-[13px] leading-[22px] text-[var(--notion-text)]">
          {group.items.map((item) => (
            <div
              key={item.id}
              className={
                item.status === 'failed' || item.status === 'partial_failed'
                  ? 'text-[var(--notion-red)]'
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
      .filter((group) => group.kind !== 'finalizing' && group.kind !== 'toolset_loading')
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

const WAITING_APPROVAL_SUMMARY: AssistantRichTextSegment[] = [
  { text: t(($) => $.workbench.waitingForYourInput) }
]
const WAITING_INTERACTION_SUMMARY: AssistantRichTextSegment[] = [
  { text: t(($) => $.workbench.waitingForYourInput) }
]

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
        className={`${failed ? 'text-[var(--notion-red)]' : ''} ${item.toolName === 'load_toolset' || item.toolName === 'load_skill' ? 'whitespace-pre-wrap' : ''}`}
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
      className={failed ? 'text-[var(--notion-red)]' : undefined}
    >
      <div className="min-w-0 leading-[22px]">{renderSegments(toolText)}</div>
      <div
        data-testid={workbenchSelectors.assistantReviewResultRail}
        className="mt-1 space-y-1 border-l border-[var(--notion-line-strong)] pl-3 text-xs text-[var(--notion-text-soft)]"
      >
        {item.terminalReviewDecision ? (
          <div data-review-actor="ai">
            {t(($) => $.workbench.aiReview)}
            {item.terminalReviewDecision === 'auto_approve'
              ? t(($) => $.workbench.approved)
              : t(($) => $.workbench.humanReviewRequired)}
          </div>
        ) : null}
        {review ? (
          <div data-review-actor="human">
            {t(($) => $.workbench.yourDecision)}
            {review.action === 'approve'
              ? t(($) => $.workbench.allowed)
              : review.action === 'reject'
                ? t(($) => $.workbench.rejected)
                : t(($) => $.workbench.guidanceProvided, {
                    value1: review.message ? `：${review.message}` : ''
                  })}
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
  <div className="mt-1 space-y-1 border-l border-[var(--notion-line-strong)] pl-3 text-xs text-[var(--notion-text-soft)]">
    {interaction.questions.map((question) => {
      const answer = interaction.answers?.find((item) => item.questionId === question.id)
      const labels = (question.options ?? [])
        .filter((option) => answer?.selectedOptionIds.includes(option.id))
        .map((option) => option.label)
      if (answer?.userText) labels.push(answer.userText)
      return (
        <div key={question.id}>
          <div>{question.question}</div>
          <div className="text-[var(--notion-text)]">
            {labels.join('、') || t(($) => $.workbench.notProvided)}
          </div>
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
      toolsetKey: group.toolsetKey,
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
                reviewingCount === 1
                  ? t(($) => $.workbench.reviewingTerminalCommand)
                  : t(($) => $.workbench.reviewingTerminalCommands, { value1: reviewingCount })
            }
          ]
        : onlyNotExecutedTerminalItems
          ? [{ text: t(($) => $.workbench.commandDidNotRun2) }]
          : buildAssistantExecutionSummaryText(summaryGroups)
  const iconKind =
    waitingUser || reviewingCount > 0 ? 'terminal' : resolveAssistantExecutionIcon(groups)
  // 等待用户操作时整轮停止动效：header 不再流光，文案回到中性灰。
  const headerShimmer = !waitingUser && (reviewingCount > 0 || shimmerActive)
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
            headerShimmer ? 'text-[var(--notion-text)]' : 'text-[var(--notion-text-faint)] group-hover/execution:text-[var(--notion-text)]'
          }`}
        >
          <LayerIcon iconKind={iconKind} />
          <span className={`min-w-0 truncate ${headerShimmer ? 'font-medium' : ''}`}>
            {renderSegments(summaryText, { shimmer: headerShimmer })}
          </span>
          {items.length > 0 ? (
            <>
              <HiChevronRight className="h-4 w-4 shrink-0 text-[var(--notion-text-faint)] opacity-0 transition-all duration-200 group-hover/execution:opacity-100 group-open/execution:hidden" />
              <HiChevronDown className="hidden h-4 w-4 shrink-0 text-[var(--notion-text-faint)] transition-all duration-200 group-open/execution:block" />
            </>
          ) : null}
        </span>
      </summary>
      {items.length > 0 ? (
        <div className="mt-1 space-y-0.5 pl-5 text-[13px] leading-[22px] text-[var(--notion-text-soft)]">
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
  isStreaming,
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
  let visibleAnswerMarkdown =
    finalAnswerMarkdown || (streamingRole === 'answer' ? streamingMarkdown : '')
  if (turn?.status === 'failed' && turn.error) {
    // Failed run snapshots may include the same title shown by the failure card.
    const failureLine = `失败：${turn.error}`
    const suffix = `\n\n${failureLine}`
    if (visibleAnswerMarkdown === failureLine) visibleAnswerMarkdown = ''
    else if (visibleAnswerMarkdown.endsWith(suffix)) {
      visibleAnswerMarkdown = visibleAnswerMarkdown.slice(0, -suffix.length)
    }
  }
  const hasFinalAnswer = visibleAnswerMarkdown.trim().length > 0
  const hasStreamingThought = streamingRole === 'thought' && streamingMarkdown.trim().length > 0
  const hasNextAiContentForActivity =
    hasFinalAnswer || hasStreamingThought || Boolean(turn?.runFinished)
  const processGroups = useMemo(
    () =>
      presentSubagentGroups(
        (turn?.processGroups || []).filter((group) => group.kind !== 'thinking')
      ),
    [turn?.processGroups]
  )
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
  const lastEntry = timeline[timeline.length - 1]
  const runAlive = isAssistantRunAlive({
    runFinished: turn?.runFinished,
    waitingApproval: turn?.waitingApproval,
    waitingInteraction: turn?.waitingInteraction,
    status: turn?.status
  })
  /** 底部行自带动效（运行中的重试 / 压缩 / 子任务头像）时不再补球。 */
  const lastEntrySelfAnimated = (() => {
    if (!lastEntry || lastEntry.kind !== 'group') return false
    const group = lastEntry.group
    if (group.subagents?.length) return group.subagents.some((child) => child.status === 'running')
    return group.status === 'running'
  })()
  /** 整轮只有这一处存活信号：文字尾部黑球 / header 流光 / 冷启动占位球。 */
  const liveTailOwner = resolveAssistantLiveTailOwner({
    runAlive,
    hasFinalAnswer,
    hasStreamingThought,
    lastEntry: lastEntry ? { kind: lastEntry.kind, selfAnimated: lastEntrySelfAnimated } : undefined
  })
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
    <SubagentCloudProvider groups={processGroups}>
      <div className="w-full" data-testid={`workbench-assistant-turn-${messageId}`}>
        <div className="space-y-4">
          {timeline.length > 0 || hasStreamingThought || runAlive || turn.startedAt ? (
            <div data-testid={`${workbenchSelectors.assistantProcessPrefix}-${messageId}`}>
              {turn.startedAt ? (
                turn.runFinished ? (
                  <button
                    type="button"
                    className="mb-2 flex w-full items-center justify-start gap-1.5 border-b border-[var(--notion-line)] pb-2 text-left text-[13px] leading-5 text-[var(--notion-text-faint)]"
                    aria-expanded={processExpanded}
                    aria-label={t(($) => $.workbench.activityLog, {
                      value1: processExpanded
                        ? t(($) => $.workbench.collapse)
                        : t(($) => $.workbench.expand)
                    })}
                    data-testid={`${workbenchSelectors.assistantProcessTogglePrefix}-${messageId}`}
                    onClick={() => setProcessExpanded((expanded) => !expanded)}
                  >
                    <span
                      data-testid={`${workbenchSelectors.assistantRunDurationPrefix}-${messageId}`}
                    >
                      {t(($) => $.workbench.duration)}
                      {formatRunDuration(turn.startedAt, turn.finishedAt ?? currentTime)}
                    </span>
                    {processExpanded ? (
                      <HiChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <HiChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                  </button>
                ) : (
                  <div className="mb-2 flex items-center border-b border-[var(--notion-line)] pb-2 text-[14px] leading-6 text-[var(--notion-text)]">
                    <span
                      data-testid={`${workbenchSelectors.assistantRunDurationPrefix}-${messageId}`}
                    >
                      {t(($) => $.workbench.handled)}
                      {formatRunDuration(turn.startedAt, currentTime)}
                    </span>
                  </div>
                )
              ) : null}
              {processExpanded ? (
                <div className="space-y-2">
                  {timeline.map((entry) => {
                    if (entry.kind === 'decision') {
                      return (
                        <AssistantProcessThoughtView
                          key={entry.id}
                          thought={entry.thought}
                          liveTail={
                            liveTailOwner === 'thought' &&
                            !hasStreamingThought &&
                            entry.id === lastEntry?.id
                          }
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
                            entry.id === lastEntry?.id &&
                            shouldActivityHeaderShimmer({
                              activityCreatedAt: entry.createdAt,
                              thoughts: processThoughts,
                              hasNextAiContent: hasNextAiContentForActivity,
                              waitingForUser: Boolean(
                                entry.waitingApproval || entry.waitingInteraction
                              )
                            })
                          }
                        />
                      )
                    }
                    return <AssistantProcessGroupView key={entry.id} group={entry.group} />
                  })}
                  {streamingRole === 'thought' && streamingMarkdown.trim() ? (
                    <div className="min-w-0 px-2 py-0.5 -mx-2 text-[13.5px] leading-[22px] text-[var(--notion-text)]">
                      <MarkdownRenderer
                        content={streamingMarkdown}
                        variant="thought"
                        streaming={Boolean(isStreaming)}
                        liveTail={liveTailOwner === 'thought' && hasStreamingThought}
                        onOpenReference={onOpenReference}
                      />
                    </div>
                  ) : null}
                  {liveTailOwner === 'placeholder' ? (
                    <div
                      className="flex h-6 items-center text-[13.5px]"
                      data-testid={workbenchSelectors.assistantLiveDot}
                      aria-hidden
                    >
                      <span className="nc-live-dot" />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {hasFinalAnswer ? (
            <div
              className="min-w-0 text-[15px] leading-7 text-[var(--notion-text)]"
              data-testid={`${workbenchSelectors.assistantFinalAnswerPrefix}-${messageId}`}
            >
              <MarkdownRenderer
                content={visibleAnswerMarkdown}
                linkAccess={turn.linkAccess}
                streaming={Boolean(isStreaming) && !finalAnswerMarkdown}
                liveTail={liveTailOwner === 'answer'}
                onOpenReference={onOpenReference}
                onOpenImage={onPreviewImage}
              />
            </div>
          ) : null}

          {turn.status === 'failed' && turn.error ? (
            <div
              className="rounded-[8px] border border-[var(--notion-red)] bg-[var(--notion-red-bg)] px-4 py-3 text-sm leading-6 text-[var(--notion-red)]"
              data-testid={`${workbenchSelectors.assistantRunFailurePrefix}-${messageId}`}
            >
              <div>
                {t(($) => $.workbench.failed2)}
                {turn.error}
              </div>
              {turn.errorDetail ? (
                <details className="mt-2">
                  <summary
                    className="cursor-pointer select-none text-xs text-[var(--notion-red-text-deep)] underline-offset-2 hover:underline"
                    data-testid={`${workbenchSelectors.assistantRunFailureDetailTogglePrefix}-${messageId}`}
                  >
                    {t(($) => $.workbench.viewDetails)}
                  </summary>
                  <pre
                    className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--notion-red-bg-hover)] px-3 py-2 text-xs leading-5 text-[var(--notion-red-text-deep)]"
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
            <div className="overflow-hidden rounded-[8px] border border-[var(--notion-line-strong)] bg-[var(--notion-page)]">
              <div className="flex items-center gap-3 border-b border-[var(--notion-line)] px-3.5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--notion-surface)] text-[var(--notion-text-soft)]">
                  <HiOutlineDocumentText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--notion-text)]">
                    {t(($) => $.workbench.changedFiles)}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--notion-text-soft)]">
                    {t(($) => $.workbench.clickAFileToReviewItsChanges)}
                  </div>
                </div>
                <div
                  className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-[var(--notion-text)]"
                  data-testid={`${workbenchSelectors.assistantTurnApplyCountPrefix}-${messageId}`}
                >
                  {turn.applyTargets.length}
                  {t(($) => $.common.items2)}
                </div>
              </div>
              <div>
                {visibleApplyTargets.map((apply) => {
                  const statusLabel =
                    apply.status === 'reverted'
                      ? apply.operation === 'created'
                        ? t(($) => $.common.deleted)
                        : t(($) => $.workbench.reverted)
                      : apply.status === 'failed'
                        ? t(($) => $.common.failed)
                        : null
                  return (
                    <button
                      key={apply.changeId}
                      type="button"
                      onClick={() => onOpenApply(apply.changeId)}
                      data-testid={`${workbenchSelectors.assistantTurnApplyPrefix}-${apply.changeId}`}
                      className="w-full border-b border-[var(--notion-line)] px-3.5 py-2.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-[var(--notion-surface-sunken)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <WorkspacePathLabel
                            filePath={apply.sourcePath || apply.title}
                            workspaces={workspaces}
                            className="text-[13px] font-medium"
                            fileNameClassName="text-[var(--notion-text)]"
                            prefixClassName="text-[var(--notion-text-faint)]"
                            separator="/"
                          />
                        </div>
                        <span className="flex shrink-0 items-center gap-1 pt-0.5">
                          <ChangeCountBadges
                            insertCount={apply.insertCount}
                            deleteCount={apply.deleteCount}
                          />
                          {statusLabel ? (
                            <span className="inline-flex h-5 items-center rounded-[4px] bg-[var(--notion-surface)] px-1.5 text-[11px] font-medium text-[var(--notion-text-soft)]">
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
                  className="flex w-full items-center gap-1.5 border-t border-[var(--notion-line)] px-3.5 py-2 text-left text-xs font-medium text-[var(--notion-text-soft)] transition-colors duration-200 hover:bg-[var(--notion-surface-sunken)] hover:text-[var(--notion-text)]"
                >
                  <HiChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                      applyTargetsExpanded ? 'rotate-180' : ''
                    }`}
                  />
                  {applyTargetsExpanded
                    ? t(($) => $.workbench.collapseFiles)
                    : t(($) => $.preferences.moreFiles, {
                        count: turn.applyTargets.length - MAX_VISIBLE_APPLY_TARGETS
                      })}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </SubagentCloudProvider>
  )
}

export default React.memo(AssistantTurnCard)
