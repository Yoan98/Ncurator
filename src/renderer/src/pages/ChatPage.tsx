import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, Input, Modal, Spin, Tooltip } from 'antd'
import {
  HiArrowUp,
  HiCheck,
  HiChevronLeft,
  HiChevronRight,
  HiOutlineClipboardDocument,
  HiOutlineClock,
  HiOutlinePencilSquare,
  HiOutlineQuestionMarkCircle,
  HiPhoto,
  HiPlus,
  HiStop,
  HiTrash,
  HiXMark
} from 'react-icons/hi2'
import { BsPinAngle, BsPinAngleFill } from 'react-icons/bs'
import { PiEraser } from 'react-icons/pi'
import type {
  AiArtifactRef,
  AiFileChangeRecord,
  AiRunEvent,
  AiRunRecord,
  BrowserTabState,
  ChatAttachment,
  ChatMessage,
  ChatMessageContentNode,
  Partner,
  PartnerListItem,
  PartnerRunSnapshot,
  PartnerUiPanelState,
  PartnerUiStateV1,
  PartnerAvatarShape,
  PartnerAvatarColor,
  LLMConfig,
  LlmRemoteModel,
  ScheduledTask,
  SelectedReference,
  WorkbenchModelSelection,
  WorkspaceSource
} from '../../../shared/types'
import {
  PARTNER_AVATAR_SHAPES,
  PARTNER_AVATAR_COLORS
} from '../../../shared/types'
import { NO_EFFECTIVE_FILE_CHANGE_MESSAGE, USER_MANUAL_URL } from '../../../shared/constants'
import { findBrowserTabByUrl } from '../../../shared/browserUrl'
import {
  pickFallbackWorkbenchModel,
  resolveSelectedWorkbenchModel
} from '../../../shared/workbenchModelSelection'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useNavigate } from 'react-router-dom'
import { normalizeUserFacingError } from '../utils/userFacingError'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import AssistantTurnCard from '../components/workbench/AssistantTurnCard'
import { FullAccessConfirmModal } from '../components/workbench/FullAccessConfirmModal'
import WorkbenchComposer from '../components/workbench/WorkbenchComposer'
import { MessageTimeline } from '../components/workbench/MessageTimeline'
import {
  buildTimelineNodes,
  collectMessageDayStarts,
  resolveActiveTimelineNodeId,
  startOfLocalDay,
  type TimelineNode,
  DAY_MS
} from '../../../shared/workbench/messageTimeline'
import {
  collectUserMessageTimeIds,
  formatUserMessageTimeLabel
} from '../../../shared/workbench/messageTimeLabel'
import WorkbenchContentPanel from '../components/workbench/WorkbenchContentPanel'
import ScheduledTasksView from '../components/scheduledTasks/ScheduledTasksView'
import ScheduledTaskCountChip from '../components/scheduledTasks/ScheduledTaskCountChip'
import MessageActionCapsule from '../components/workbench/MessageActionCapsule'
import ImageLightbox from '../components/workbench/ImageLightbox'
import AttachmentFileIcon from '../components/workbench/composer/AttachmentFileIcon'
import ReferenceInlineToken from '../components/workbench/composer/ReferenceInlineToken'
import type { ImageLightboxImage } from '../components/workbench/ImageLightbox'
import type { ComposerDraftValue } from '../components/workbench/composer/types'
import {
  WORKBENCH_CONTENT_PANEL_COLLAPSE_WIDTH,
  WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO,
  WORKBENCH_CONTENT_PANEL_MAX_RATIO,
  WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH,
  WORKBENCH_CONTENT_PANEL_MIN_WIDTH,
  WORKBENCH_CONTENT_PANEL_RATIO_STORAGE_KEY,
  WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH,
  WORKBENCH_LEGACY_PREFERENCE_STORAGE_KEYS,
  WORKBENCH_SIDEBAR_DEFAULT_WIDTH,
  WORKBENCH_SIDEBAR_MAX_WIDTH,
  WORKBENCH_SIDEBAR_MIN_WIDTH,
  WORKBENCH_SIDEBAR_STORAGE_KEY,
  WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY,
  clampWorkbenchContentPanelRatio,
  resolveWorkbenchContentPanelWidth
} from '../components/workbench/constants'
import type {
  AssistantTurnViewModel,
  WorkbenchContextUsage,
  WorkbenchContentPanelState,
  WorkbenchFileRef,
  WorkbenchResourceTab,
  WorkbenchTabWorkspaceState,
  WorkbenchAiPreference,
  WorkbenchExecutionPermission
} from '../components/workbench/types'
import type { OpenableMarkdownReference } from '../components/markdownReference'
import {
  completeAssistantProcessGroups,
  dedupeFileRefs,
  extractReadableFilesFromToolOutput,
  formatRelativeTime,
  getAttachmentTypeLabel,
  reduceAssistantProcessGroups,
  reduceAssistantProcessThoughts
} from '../components/workbench/utils'
import { clipPartnerListPreview, PARTNER_LIST_EMPTY_PREVIEW } from '../../../shared/workbench/conversationProjection'
import { projectApprovalReviews, projectProcessGroups } from '../components/workbench/messageLogProjection'
import {
  groupApplyTargetsByRunId,
  mergeApplyTargets
} from '../components/workbench/applyTargetUtils'
import {
  filterVisibleFileChangeRecords,
  isRuntimeAssetPath
} from '../../../shared/fileChangeVisibility'
import {
  createFileChangeListRequest,
  createFileChangeRunScope,
  filterFileChangeRecordsForScope,
  isCurrentFileChangeRunScope,
  type FileChangeRunScope
} from '../../../shared/aiFileChangeScope'
import { chatSelectors, workbenchSelectors } from '../testing/selectors'
import SidebarPanelIcon from '../components/SidebarPanelIcon'
import brandIcon from '../../../../logo/png/ncurator-logo-24.png'
import PartnerAvatar, { PARTNER_AVATAR_COLOR_HEX } from '../components/workbench/PartnerAvatar'
import SidebarUpdateControl from '../components/update/SidebarUpdateControl'

type ApprovalBatchRequiredEvent = Extract<AiRunEvent, { type: 'approval_batch_required' }>
type ApprovalBatchDecisionAction = 'approve' | 'reject' | 'guide'
type WorkbenchE2EWindow = Window &
  typeof globalThis & {
    __NCURATOR_E2E_SET_WORKBENCH_DRAFT__?: (draft: ComposerDraftValue) => void
  }

type ApplyRevertConfirmState = {
  changeId: string
  stage: 'confirm' | 'force'
  content: string
}

type ApprovalDraftDecision = {
  action?: ApprovalBatchDecisionAction
  message: string
}

const SCROLL_BOTTOM_TOLERANCE = 72
const WORKBENCH_DRAG_REGION_STYLE = {
  WebkitAppRegion: 'drag'
} as React.CSSProperties
const WORKBENCH_NO_DRAG_REGION_STYLE = {
  position: 'relative',
  zIndex: 2,
  WebkitAppRegion: 'no-drag'
} as React.CSSProperties
const WORKBENCH_NO_DRAG_STYLE = {
  WebkitAppRegion: 'no-drag'
} as React.CSSProperties
const WORKBENCH_POSITIONED_PANE_STYLE = {
  position: 'relative'
} as React.CSSProperties

type FileSystemDragItem = DataTransferItem & {
  webkitGetAsEntry?: () => { isFile: boolean } | null
}

const getDroppedFiles = (transfer: DataTransfer): File[] =>
  Array.from(transfer.items).flatMap((item) => {
    const entry = (item as FileSystemDragItem).webkitGetAsEntry?.()
    if (entry && !entry.isFile) return []
    const file = item.getAsFile()
    return file ? [file] : []
  })

const detectRendererPlatform = (): string =>
  navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin'

const PARTNER_ROW_ACTION_CLASS =
  'flex h-6 w-6 items-center justify-center rounded-[6px] text-[#91918E] transition hover:bg-white hover:text-[#37352F]'

const clampWorkbenchSidebarWidth = (width: number): number =>
  Math.max(WORKBENCH_SIDEBAR_MIN_WIDTH, Math.min(WORKBENCH_SIDEBAR_MAX_WIDTH, width))

const createEmptyPanel = (): WorkbenchContentPanelState => ({
  kind: 'empty',
  title: '',
  description: ''
})

const EMPTY_TAB_WORKSPACE: WorkbenchTabWorkspaceState = {
  tabs: [],
  activeTabId: null,
  panelCollapsed: true
}

const getFileTabId = (filePath: string, platform: string): string => {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return `file:${platform === 'win32' ? normalized.toLowerCase() : normalized}`
}

const getFileTabTitle = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).pop() || normalized || '文件'
}

const createAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  messageId,
  status: 'running',
  runFinished: false,
  isBrainThinking: false,
  processThoughts: [],
  processGroups: [],
  finalAnswerMarkdown: '',
  streamingMarkdown: '',
  streamingRole: 'answer',
  plan: [],
  artifacts: [],
  applyTargets: [],
  waitingApproval: false,
  pendingApprovalItems: [],
  approvalReviews: []
})

const createThinkingAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  ...createAssistantTurn(messageId),
  isBrainThinking: true
})

const createSearchAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  ...createAssistantTurn(messageId),
  status: 'completed',
  runFinished: true
})

const artifactToApplyTarget = (
  artifact: AiArtifactRef
): AssistantTurnViewModel['applyTargets'][number] | null => {
  if (artifact.kind !== 'file' || !artifact.applyId || isRuntimeAssetPath(artifact.path))
    return null
  return {
    changeId: artifact.applyId,
    title: artifact.fileName,
    sourcePath: artifact.path,
    operation: artifact.operation,
    changeCount: 0,
    insertCount: 0,
    deleteCount: 0,
    status: 'applied'
  }
}

const buildSearchTurnFromProjectedMessage = (message: ChatMessage): AssistantTurnViewModel => ({
  ...createSearchAssistantTurn(message.id),
  status: message.error ? 'failed' : 'completed',
  runFinished: true,
  processGroups: completeAssistantProcessGroups(
    createSearchAssistantTurn(message.id).processGroups
  ),
  finalAnswerMarkdown: message.content,
  artifacts: (message.artifacts || []).map((artifact) => ({
    path: artifact.path,
    fileName: artifact.fileName,
    origin: 'artifact' as const,
    applyId: artifact.applyId,
    operation: artifact.operation,
    format:
      artifact.capability === 'docx' ? 'docx' : artifact.capability === 'ppt' ? 'pptx' : undefined
  })),
  applyTargets: (message.artifacts || [])
    .map(artifactToApplyTarget)
    .filter((target): target is AssistantTurnViewModel['applyTargets'][number] => Boolean(target))
})

const formatRunFailureTitle = (event: Extract<AiRunEvent, { type: 'run_failed' }>): string =>
  event.message?.trim() || '运行失败，请重试'

const formatRunFailureDetail = (
  event: Extract<AiRunEvent, { type: 'run_failed' }>
): string | undefined => {
  const metadata = [
    event.httpStatus ? `HTTP ${event.httpStatus}` : '',
    event.providerCode || ''
  ].filter(Boolean)
  const raw = event.rawMessage?.trim() || ''
  if (metadata.length === 0 && !raw) return undefined
  if (metadata.length === 0) return raw
  if (!raw) return metadata.join(' · ')
  return `${metadata.join(' · ')}\n${raw}`
}

const reduceAssistantTurnByRunEvent = (
  turn: AssistantTurnViewModel,
  event: AiRunEvent
): AssistantTurnViewModel => {
  let next: AssistantTurnViewModel = {
    ...turn,
    processThoughts: reduceAssistantProcessThoughts(turn.processThoughts, event),
    processGroups: reduceAssistantProcessGroups(turn.processGroups, event)
  }

  if (event.type === 'tool_call_result') {
    const toolOutput = event.result?.data ?? null
    const readFiles = extractReadableFilesFromToolOutput(
      toolOutput,
      event.toolName.includes('search') ? 'search_hit' : 'read'
    )
    if (readFiles.length > 0) {
      next = {
        ...next,
        artifacts: dedupeFileRefs([...next.artifacts, ...readFiles])
      }
    }
  }

  if (event.type === 'file_artifact' && !isRuntimeAssetPath(event.path)) {
    next = {
      ...next,
      artifacts: dedupeFileRefs([
        ...next.artifacts,
        {
          path: event.path,
          fileName: event.fileName,
          origin: 'artifact',
          applyId: event.applyId,
          operation: event.operation,
          format:
            event.capability === 'docx' ? 'docx' : event.capability === 'ppt' ? 'pptx' : undefined
        }
      ]),
      applyTargets: event.applyId
        ? mergeApplyTargets(next.applyTargets, {
            changeId: event.applyId,
            title: event.fileName,
            sourcePath: event.path,
            operation: event.operation,
            changeCount: event.changeCount ?? 0,
            insertCount: event.insertCount ?? 0,
            deleteCount: event.deleteCount ?? 0,
            status: 'applied'
          })
        : next.applyTargets
    }
  }

  if (
    event.type === 'assistant_process_group_started' &&
    (event.kind === 'thinking' || event.display?.kind === 'thinking')
  ) {
    next = { ...next, isBrainThinking: true }
  }

  if (
    (event.type === 'assistant_process_group_completed' ||
      event.type === 'assistant_process_group_failed') &&
    (event.groupId.endsWith(':thinking') || event.display?.kind === 'thinking')
  ) {
    next = { ...next, isBrainThinking: false }
  }

  if (event.type === 'tool_call_started') {
    next = { ...next, isBrainThinking: false }
  }

  if (event.type === 'run_warning') {
    // 告警不停跑：仅结束「让俺想想」，不把 turn 标 failed。
    next = { ...next, isBrainThinking: false }
  }

  if (event.type === 'approval_batch_required') {
    if (!event.internal) {
      next = {
        ...next,
        isBrainThinking: false,
        waitingApproval: true,
        pendingApprovalItems: event.items
      }
    }
  }

  if (event.type === 'approval_batch_decision') {
    if (!event.internal) {
      const decisionByItemId = new Map(
        event.decisions.map((decision) => [decision.itemId, decision] as const)
      )
      const nextReviews = next.pendingApprovalItems.map((item) => {
        const decision = decisionByItemId.get(item.itemId)
        return {
          toolCallId: item.itemId,
          toolName: item.toolName,
          command: item.command,
          commandExplanation: item.commandExplanation,
          action: (decision?.action || 'reject') as 'approve' | 'reject' | 'guide',
          message:
            typeof decision?.message === 'string' && decision.message.trim()
              ? decision.message.trim()
              : undefined
        }
      })
      next = {
        ...next,
        waitingApproval: false,
        pendingApprovalItems: [],
        approvalReviews: [...next.approvalReviews, ...nextReviews]
      }
    }
  }

  if (event.type === 'assistant_brain_stream_started') {
    next = {
      ...next,
      isBrainThinking: true,
      streamingRoundId: event.roundId,
      streamingMarkdown: '',
      streamingRole: 'answer'
    }
  }

  if (
    event.type === 'assistant_brain_stream_delta' &&
    next.streamingRoundId === event.roundId
  ) {
    next = {
      ...next,
      isBrainThinking: false,
      streamingMarkdown: `${next.streamingMarkdown}${event.text}`
    }
  }

  if (
    event.type === 'assistant_brain_stream_reset' &&
    next.streamingRoundId === event.roundId
  ) {
    next = { ...next, streamingMarkdown: '', streamingRole: 'answer' }
  }

  if (
    event.type === 'assistant_brain_stream_classified' &&
    next.streamingRoundId === event.roundId
  ) {
    next = { ...next, isBrainThinking: false, streamingRole: 'thought' }
  }

  if (
    event.type === 'assistant_brain_stream_completed' &&
    next.streamingRoundId === event.roundId
  ) {
    next =
      event.role === 'answer'
        ? {
            ...next,
            isBrainThinking: false,
            finalAnswerMarkdown: event.text,
            streamingMarkdown: '',
            streamingRole: 'answer'
          }
        : {
            ...next,
            isBrainThinking: false,
            streamingMarkdown: event.text,
            streamingRole: 'thought'
          }
  }

  if (event.type === 'assistant_process_thought') {
    next = { ...next, isBrainThinking: false, streamingMarkdown: '', streamingRole: 'answer' }
  }

  if (event.type === 'assistant_plan_updated') {
    next = { ...next, plan: event.plan }
  }

  if (event.type === 'answer_token') {
    next = {
      ...next,
      isBrainThinking: false,
      finalAnswerMarkdown: `${next.finalAnswerMarkdown}${event.token}`,
      processGroups: completeAssistantProcessGroups(next.processGroups)
    }
  }

  if (event.type === 'answer_completed') {
    next = {
      ...next,
      isBrainThinking: false,
      finalAnswerMarkdown: event.text,
      linkAccess: event.linkAccess || [],
      streamingMarkdown: '',
      processGroups: completeAssistantProcessGroups(next.processGroups)
    }
  }

  if (event.type === 'run_failed') {
    next = {
      ...next,
      isBrainThinking: false,
      status: 'failed',
      runFinished: true,
      error: formatRunFailureTitle(event),
      errorDetail: formatRunFailureDetail(event)
    }
  }

  if (event.type === 'run_cancelled') {
    next = { ...next, isBrainThinking: false, status: 'failed', runFinished: true, error: '已取消' }
  }

  if (event.type === 'run_completed') {
    next = {
      ...next,
      isBrainThinking: false,
      runFinished: true,
      status: next.status === 'failed' ? 'failed' : 'completed',
      plan: []
    }
  }

  return next
}

const applyRunRecordToTurn = (
  turn: AssistantTurnViewModel,
  run: AiRunRecord
): AssistantTurnViewModel => {
  const artifacts = run.artifacts || []
  const runFinished =
    run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
  const status =
    run.status === 'completed'
      ? 'completed'
      : run.status === 'failed' || run.status === 'cancelled'
        ? 'failed'
        : 'running'
  return {
    ...turn,
    runId: run.id,
    status,
    runFinished,
    isBrainThinking: runFinished ? false : turn.isBrainThinking,
    processGroups: runFinished
      ? completeAssistantProcessGroups(turn.processGroups)
      : turn.processGroups,
    finalAnswerMarkdown:
      run.finalAnswer ||
      (run.partialAnswerRole !== 'thought' ? run.partialAnswer : '') ||
      turn.finalAnswerMarkdown,
    streamingMarkdown: run.finalAnswer ? '' : run.partialAnswer || turn.streamingMarkdown,
    streamingRole: run.partialAnswerRole || turn.streamingRole,
    artifacts: dedupeFileRefs([
      ...turn.artifacts,
      ...artifacts.map((artifact) => ({
        path: artifact.path,
        fileName: artifact.fileName,
        origin: 'artifact' as const,
        applyId: artifact.applyId,
        operation: artifact.operation,
        format:
          artifact.capability === 'docx'
            ? ('docx' as const)
            : artifact.capability === 'ppt'
              ? ('pptx' as const)
              : undefined
      }))
    ]),
    applyTargets: artifacts.reduce<AssistantTurnViewModel['applyTargets']>(
      (items, artifact) => {
        const target = artifactToApplyTarget(artifact)
        if (!target || items.some((item) => item.changeId === target.changeId)) return items
        return [...items, target]
      },
      turn.applyTargets
    ),
    waitingApproval: Boolean(run.pendingApproval),
    pendingApprovalItems: run.pendingApproval?.items ?? turn.pendingApprovalItems,
    error: run.error || turn.error,
    errorDetail: run.failureRawMessage || turn.errorDetail
  }
}

const buildAssistantTurnFromRunSnapshot = (
  snapshot: PartnerRunSnapshot
): AssistantTurnViewModel => {
  const projected = projectProcessGroups({
    runId: snapshot.run.id,
    records: snapshot.messageLogRecords || [],
    runFinished:
      snapshot.run.status === 'completed' ||
      snapshot.run.status === 'failed' ||
      snapshot.run.status === 'cancelled'
  })
  const approvalReviews = projectApprovalReviews({
    records: snapshot.messageLogRecords || []
  })
  const base: AssistantTurnViewModel = {
    ...createAssistantTurn(snapshot.run.assistantMessageId),
    runId: snapshot.run.id,
    processThoughts: projected.processThoughts,
    processGroups: projected.processGroups,
    isBrainThinking: projected.isBrainThinking,
    waitingApproval: Boolean(snapshot.run.pendingApproval),
    pendingApprovalItems: snapshot.run.pendingApproval?.items || [],
    approvalReviews
  }
  for (const record of snapshot.messageLogRecords || []) {
    const entry = record.entry
    if (entry.kind === 'annotation' && entry.eventType === 'plan_updated') {
      base.plan = entry.payload.plan
    } else if (entry.kind === 'annotation' && entry.eventType === 'finalizing_started') {
      base.plan = []
    } else if (
      entry.kind === 'assistant' &&
      entry.toolCalls.length === 0 &&
      entry.linkAccess !== undefined
    ) {
      base.linkAccess = entry.linkAccess
    }
  }
  return applyRunRecordToTurn(base, snapshot.run)
}

const appendArtifactForMessage = (
  store: Record<string, AiArtifactRef[]>,
  messageId: string,
  artifact: AiArtifactRef
): void => {
  const currentArtifacts = store[messageId] || []
  const exists = currentArtifacts.some(
    (item) => item.path === artifact.path && item.applyId === artifact.applyId
  )
  if (!exists) {
    store[messageId] = [...currentArtifacts, artifact]
  }
}

const ACTIVE_FILE_CHANGE_STATUSES = new Set<AiFileChangeRecord['status']>([
  'applied',
  'failed',
  'reverted'
])

const sortFileChangeRecords = (items: AiFileChangeRecord[]): AiFileChangeRecord[] => {
  const latestById = new Map<string, AiFileChangeRecord>()
  items.forEach((item) => {
    const current = latestById.get(item.id)
    if (!current || item.updatedAt > current.updatedAt) {
      latestById.set(item.id, item)
    }
  })
  const priority: Record<AiFileChangeRecord['status'], number> = {
    applied: 0,
    failed: 1,
    reverted: 2
  }
  return [...latestById.values()].sort((left, right) => {
    const updatedAtGap = right.updatedAt - left.updatedAt
    if (updatedAtGap !== 0) return updatedAtGap
    const priorityGap = priority[left.status] - priority[right.status]
    if (priorityGap !== 0) return priorityGap
    return right.createdAt - left.createdAt
  })
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

const appendMessagesDedupe = (
  current: ChatMessage[],
  additions: Array<ChatMessage | undefined>
): ChatMessage[] => {
  const seen = new Set(current.map((message) => message.id))
  const next = [...current]
  for (const message of additions) {
    if (!message || seen.has(message.id)) continue
    seen.add(message.id)
    next.push(message)
  }
  return next.sort((left, right) => left.timestamp - right.timestamp)
}

const createEmptyComposerDraft = (): ComposerDraftValue => ({
  input: '',
  contentNodes: [],
  selectedReferences: [],
  attachments: [],
  assetBucketId: null
})

const toPersistedComposerDraft = (
  draft: ComposerDraftValue
): PartnerUiStateV1['composer']['draft'] => ({
  input: draft.input,
  contentNodes: draft.contentNodes,
  selectedReferences: draft.selectedReferences,
  attachments: draft.attachments,
  assetBucketId: draft.assetBucketId || null
})

const createDefaultPartnerUiState = (
  modelSelection: WorkbenchModelSelection = { mainModel: null }
): PartnerUiStateV1 => ({
  version: 1,
  composer: {
    aiPreference: 'default',
    executionPermission: 'review',
    modelSelection,
    draft: toPersistedComposerDraft(createEmptyComposerDraft())
  },
  panel: {
    tabs: [],
    activeTabId: null,
    collapsed: true,
    fallbackState: createEmptyPanel() as PartnerUiPanelState
  }
})

const isComposerDraftEmpty = (draft: ComposerDraftValue): boolean =>
  !draft.input.trim() &&
  draft.contentNodes.length === 0 &&
  draft.selectedReferences.length === 0 &&
  draft.attachments.length === 0

const getUserMessageContentNodes = (messageItem: ChatMessage): ChatMessageContentNode[] =>
  messageItem.contentNodes && messageItem.contentNodes.length > 0
    ? messageItem.contentNodes
    : [
        ...(messageItem.selectedReferences || []).map(
          (reference): ChatMessageContentNode => ({ kind: 'reference', reference })
        ),
        ...(messageItem.content ? [{ kind: 'text' as const, text: messageItem.content }] : [])
      ]

const getUserMessagePlainText = (messageItem: ChatMessage): string =>
  getUserMessageContentNodes(messageItem)
    .map((node) => (node.kind === 'reference' ? `@${node.reference.name}` : node.text))
    .join('')

const getUserAttachmentPaths = (messages: readonly ChatMessage[]): string[] =>
  messages.flatMap((messageItem) =>
    (messageItem.attachments || []).map((attachment) => attachment.path)
  )

const ChatPage: React.FC = () => {
  const { message, modal } = AntdApp.useApp()
  const navigate = useNavigate()
  const [partners, setPartners] = useState<PartnerListItem[]>([])
  const [partnersListHydrated, setPartnersListHydrated] = useState(false)
  const [currentPartnerId, setCurrentPartnerId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [switchingPartnerId, setSwitchingPartnerId] = useState<string | null>(null)
  const [hasMoreMessagesBefore, setHasMoreMessagesBefore] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [deleteConfirmPartner, setDeleteConfirmPartner] = useState<Partner | null>(null)
  const [deletingPartnerIds, setDeletingPartnerIds] = useState<Set<string>>(() => new Set())
  const [createPartnerOpen, setCreatePartnerOpen] = useState(false)
  const [editingPartnerId, setEditingPartnerId] = useState<string | null>(null)
  const [createPartnerName, setCreatePartnerName] = useState('')
  const [createPartnerShape, setCreatePartnerShape] = useState<PartnerAvatarShape>('circle')
  const [createPartnerColor, setCreatePartnerColor] = useState<PartnerAvatarColor>('blue')
  const [createPartnerSubmitting, setCreatePartnerSubmitting] = useState(false)
  const [busyCancelTask, setBusyCancelTask] = useState<ScheduledTask | null>(null)
  const [activeTimelineDayStart, setActiveTimelineDayStart] = useState<number | null>(null)
  const [composerAiPreference, setComposerAiPreference] = useState<WorkbenchAiPreference>('default')
  const [composerExecutionPermission, setComposerExecutionPermission] =
    useState<WorkbenchExecutionPermission>('review')
  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiRunId, setAiRunId] = useState<string | null>(null)
  const [cancellingRun, setCancellingRun] = useState(false)
  const [composerContentNodes, setComposerContentNodes] = useState<ChatMessageContentNode[]>([])
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [assetBucketId, setAssetBucketId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSource[]>([])
  const [modelConfigs, setModelConfigs] = useState<LLMConfig[]>([])
  const [modelCatalogLoaded, setModelCatalogLoaded] = useState(false)
  const [modelListsByConfigId, setModelListsByConfigId] = useState<
    Record<string, LlmRemoteModel[]>
  >({})
  const [modelSelection, setModelSelection] = useState<WorkbenchModelSelection>({
    mainModel: null
  })
  const [composerDraftKey, setComposerDraftKey] = useState('initial')
  const [contextUsage, setContextUsage] = useState<WorkbenchContextUsage | null>(null)
  const [messageAttachmentPreviewUrls, setMessageAttachmentPreviewUrls] = useState<
    Record<string, string>
  >({})
  const [previewImage, setPreviewImage] = useState<ImageLightboxImage | null>(null)
  const [assistantTurns, setAssistantTurns] = useState<Record<string, AssistantTurnViewModel>>({})
  const [contentPanel, setContentPanel] = useState<WorkbenchContentPanelState>(createEmptyPanel())
  const [tabWorkspaces, setTabWorkspaces] = useState<Record<string, WorkbenchTabWorkspaceState>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_STORAGE_KEY)
    return stored === 'true'
  })
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY)
    return clampWorkbenchSidebarWidth(stored ? Number(stored) : WORKBENCH_SIDEBAR_DEFAULT_WIDTH)
  })
  const [contentPanelRatio, setContentPanelRatio] = useState<number>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_CONTENT_PANEL_RATIO_STORAGE_KEY)
    return clampWorkbenchContentPanelRatio(
      stored ? Number(stored) : WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO
    )
  })
  const [contentPanelCollapsed, setContentPanelCollapsed] = useState(true)
  const [contentPanelShellMounted, setContentPanelShellMounted] = useState(false)
  const [contentPanelShellVisible, setContentPanelShellVisible] = useState(false)
  const [scheduledTasksActive, setScheduledTasksActive] = useState(false)
  const [scheduledTaskEnabledCount, setScheduledTaskEnabledCount] = useState(0)
  const [browserPresentationEnabled, setBrowserPresentationEnabled] = useState(false)
  const [browserTransitionImage, setBrowserTransitionImage] = useState<{
    tabId: string
    dataUrl: string
  } | null>(null)
  const restoreContentPanelWithoutAnimationRef = useRef(false)

  const [activeApplyRecord, setActiveApplyRecord] = useState<AiFileChangeRecord | null>(null)
  const [fileChangeRecords, setFileChangeRecords] = useState<AiFileChangeRecord[]>([])
  const fileChangeRunScopeRef = useRef<FileChangeRunScope | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyReverting, setApplyReverting] = useState(false)
  const [applyRevertConfirm, setApplyRevertConfirm] = useState<ApplyRevertConfirmState | null>(null)

  const [pendingApprovalBatch, setPendingApprovalBatch] =
    useState<ApprovalBatchRequiredEvent | null>(null)
  const [approvalCurrentIndex, setApprovalCurrentIndex] = useState(0)
  const [approvalDraftDecisions, setApprovalDraftDecisions] = useState<
    Record<string, ApprovalDraftDecision>
  >({})
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)

  const activeRunMessageIdsRef = useRef<Record<string, string>>({})
  const activeRunPartnerIdsRef = useRef<Record<string, string>>({})
  const assistantArtifactsRef = useRef<Record<string, AiArtifactRef[]>>({})
  const currentPartnerIdRef = useRef<string | null>(null)
  const submitInFlightRef = useRef(false)
  const lastSubmittedInputRef = useRef('')
  const partnerSwitchRequestRef = useRef(0)
  const partnerListHydratedRef = useRef(false)
  const composerDraftByPartnerIdRef = useRef<Record<string, ComposerDraftValue>>({})
  const composerDraftVersionRef = useRef(0)
  const loadApplyRecordRef = useRef<
    (input: {
      applyId: string
      detail?: AiFileChangeRecord | null
      openWorkspace?: boolean
    }) => Promise<void>
  >(async () => {})
  const loadFileChangesForPartnerRef = useRef<
    (
      partnerId: string,
      runId: string,
      options?: {
        preferredApplyId?: string | null
        autoOpen?: boolean
        forceOpenWorkspace?: boolean
        skipApplyRecordReload?: boolean
        notifyNoEffectiveChange?: boolean
      }
    ) => Promise<void>
  >(async () => {})
  const fileChangeLoadRequestRef = useRef(0)
  const sidebarDragStartRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const sidebarResizeFrameRef = useRef<number | null>(null)
  const mainSplitRef = useRef<HTMLDivElement>(null)
  const contentPanelShellRef = useRef<HTMLDivElement>(null)
  const contentPanelResizeGuideRef = useRef<HTMLDivElement>(null)
  const contentPanelRatioRef = useRef(contentPanelRatio)
  const contentPanelCommittedRatioRef = useRef(contentPanelRatio)
  const contentPanelWidthPxRef = useRef(0)
  const contentPanelDragStartRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const contentPanelDragRestoreTimerRef = useRef<number | null>(null)
  const contentPanelDragSettlingFrameRef = useRef<number | null>(null)
  const contentPanelResizeFrameRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const messageAttachmentPreviewUrlsRef = useRef<Record<string, string>>({})
  const notifiedNoEffectiveChangeIdsRef = useRef<Set<string>>(new Set())
  const composerAiPreferenceRef = useRef<WorkbenchAiPreference>(composerAiPreference)
  const composerExecutionPermissionRef = useRef<WorkbenchExecutionPermission>(
    composerExecutionPermission
  )
  const composerFileDropHandlerRef = useRef<((files: File[]) => void) | null>(null)
  const attachmentDragDepthRef = useRef(0)
  const [isAttachmentDropActive, setIsAttachmentDropActive] = useState(false)
  const modelSelectionRef = useRef<WorkbenchModelSelection>(modelSelection)
  const contentPanelRef = useRef<WorkbenchContentPanelState>(contentPanel)
  const tabWorkspacesRef = useRef<Record<string, WorkbenchTabWorkspaceState>>(tabWorkspaces)
  const contentPanelCollapsedRef = useRef(contentPanelCollapsed)
  const panelFallbackByKeyRef = useRef<Record<string, WorkbenchContentPanelState>>({})
  const uiStateReadyKeyRef = useRef<string | null>(null)
  const [uiStateReadyKey, setUiStateReadyKey] = useState<string | null>(null)
  const persistTimersRef = useRef<Record<string, number>>({})
  const pendingTimelineJumpDayRef = useRef<number | null>(null)
  const persistQueuesRef = useRef<Record<string, Promise<void>>>({})
  const persistRevisionsRef = useRef<Record<string, number>>({})
  const persistRetryTimersRef = useRef<Record<string, number>>({})
  const persistFailureNotifiedRef = useRef<Set<string>>(new Set())
  const missingAttachmentNotifiedRef = useRef<Set<string>>(new Set())
  const uiStateInteractionVersionRef = useRef(0)

  const tabWorkspaceKey = currentPartnerId || ''
  const tabWorkspace = tabWorkspaces[tabWorkspaceKey] || EMPTY_TAB_WORKSPACE

  const buildUiStateForKey = useCallback((key: string): PartnerUiStateV1 => {
    const workspace = tabWorkspacesRef.current[key] || EMPTY_TAB_WORKSPACE
    const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId)
    const fallback =
      panelFallbackByKeyRef.current[key] ||
      (!activeTab ? contentPanelRef.current : createEmptyPanel())
    return {
      version: 1,
      composer: {
        aiPreference: composerAiPreferenceRef.current,
        executionPermission: composerExecutionPermissionRef.current,
        modelSelection: modelSelectionRef.current,
        draft: toPersistedComposerDraft(composerDraftValueRef.current)
      },
      panel: {
        tabs: workspace.tabs,
        activeTabId: workspace.activeTabId,
        collapsed: contentPanelCollapsedRef.current,
        fallbackState: fallback as PartnerUiPanelState
      }
    }
  }, [])

  const persistUiStateForKey = useCallback(
    (key: string, state: PartnerUiStateV1): Promise<void> => {
      if (!key) return Promise.resolve()
      const revision = (persistRevisionsRef.current[key] || 0) + 1
      persistRevisionsRef.current[key] = revision
      const existingRetry = persistRetryTimersRef.current[key]
      if (existingRetry !== undefined) {
        window.clearTimeout(existingRetry)
        delete persistRetryTimersRef.current[key]
      }

      const enqueue = (): Promise<void> => {
        const previous = persistQueuesRef.current[key] || Promise.resolve()
        const next = previous
          .catch(() => undefined)
          .then(async () => {
            let lastError: unknown = null
            for (let attempt = 0; attempt < 3; attempt += 1) {
              try {
                const response = await window.api.partnerUiStateSave({ partnerId: key, state })
                if (!response.success) {
                  throw new Error(response.error || '保存会话状态失败')
                }
                persistFailureNotifiedRef.current.delete(key)
                return
              } catch (error) {
                lastError = error
                if (attempt < 2) await delay(attempt === 0 ? 100 : 250)
              }
            }
            throw lastError
          })
          .catch((error) => {
            console.error('Failed to persist workbench UI state', error)
            if (!persistFailureNotifiedRef.current.has(key)) {
              persistFailureNotifiedRef.current.add(key)
              message.warning('当前会话状态保存失败')
            }
            if (persistRevisionsRef.current[key] !== revision) return
            persistRetryTimersRef.current[key] = window.setTimeout(() => {
              delete persistRetryTimersRef.current[key]
              if (persistRevisionsRef.current[key] === revision) void enqueue()
            }, 1_000)
          })
        persistQueuesRef.current[key] = next
        return next
      }

      return enqueue()
    },
    [message]
  )

  const scheduleCurrentUiStatePersist = useCallback((): void => {
    const key = currentPartnerIdRef.current
    if (!key) return
    if (uiStateReadyKeyRef.current !== key) return
    const existing = persistTimersRef.current[key]
    if (existing !== undefined) window.clearTimeout(existing)
    persistTimersRef.current[key] = window.setTimeout(() => {
      delete persistTimersRef.current[key]
      void persistUiStateForKey(key, buildUiStateForKey(key))
    }, 200)
  }, [buildUiStateForKey, persistUiStateForKey])

  const persistCurrentUiStateNow = useCallback(
    async (options?: { requireReady?: boolean }): Promise<void> => {
      const key = currentPartnerIdRef.current
      if (!key) return
      if (options?.requireReady !== false && uiStateReadyKeyRef.current !== key) return
      const timer = persistTimersRef.current[key]
      if (timer !== undefined) {
        window.clearTimeout(timer)
        delete persistTimersRef.current[key]
      }
      await persistUiStateForKey(key, buildUiStateForKey(key))
    },
    [buildUiStateForKey, persistUiStateForKey]
  )

  const flushCurrentUiState = useCallback(async (): Promise<void> => {
    await persistCurrentUiStateNow({ requireReady: true })
  }, [persistCurrentUiStateNow])

  useEffect(() => {
    if (uiStateReadyKey !== tabWorkspaceKey) return () => undefined
    let cancelled = false
    void window.api.browserTabList({ ownerId: tabWorkspaceKey }).then((response) => {
      if (cancelled || !response.success || response.tabs.length === 0) return
      setTabWorkspaces((current) => {
        const workspace = current[tabWorkspaceKey] || EMPTY_TAB_WORKSPACE
        const knownIds = new Set(workspace.tabs.map((tab) => tab.id))
        const restoredTabs: WorkbenchResourceTab[] = response.tabs
          .filter((browser) => !knownIds.has(`browser:${browser.id}`))
          .map((browser) => ({
            id: `browser:${browser.id}`,
            kind: 'browser',
            browserTabId: browser.id,
            title: browser.title || (browser.url ? browser.url : '新标签页'),
            state: {
              kind: 'browser',
              title: browser.title || (browser.url ? browser.url : '新标签页'),
              browserTabId: browser.id
            }
          }))
        if (restoredTabs.length === 0) return current
        return {
          ...current,
          [tabWorkspaceKey]: { ...workspace, tabs: [...workspace.tabs, ...restoredTabs] }
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [tabWorkspaceKey, uiStateReadyKey])

  const composerDraftValue = useMemo<ComposerDraftValue>(
    () => ({
      input,
      contentNodes: composerContentNodes,
      selectedReferences,
      attachments,
      assetBucketId
    }),
    [assetBucketId, attachments, composerContentNodes, input, selectedReferences]
  )
  const composerDraftValueRef = useRef<ComposerDraftValue>(composerDraftValue)

  useEffect(() => {
    currentPartnerIdRef.current = currentPartnerId
  }, [currentPartnerId])

  useEffect(() => {
    composerDraftValueRef.current = composerDraftValue
  }, [composerDraftValue])

  useEffect(() => {
    composerAiPreferenceRef.current = composerAiPreference
    composerExecutionPermissionRef.current = composerExecutionPermission
    modelSelectionRef.current = modelSelection
    contentPanelRef.current = contentPanel
    tabWorkspacesRef.current = tabWorkspaces
    contentPanelCollapsedRef.current = contentPanelCollapsed
    scheduleCurrentUiStatePersist()
  }, [
    composerAiPreference,
    composerExecutionPermission,
    composerDraftValue,
    contentPanel,
    contentPanelCollapsed,
    modelSelection,
    scheduleCurrentUiStatePersist,
    tabWorkspaces
  ])

  useEffect(
    () => () => {
      Object.values(persistTimersRef.current).forEach((timer) => window.clearTimeout(timer))
      Object.values(persistRetryTimersRef.current).forEach((timer) => window.clearTimeout(timer))
      void flushCurrentUiState()
    },
    [flushCurrentUiState]
  )

  useEffect(() => {
    WORKBENCH_LEGACY_PREFERENCE_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key))
  }, [])

  useEffect(() => window.api.onWorkbenchUiFlushRequest(flushCurrentUiState), [flushCurrentUiState])

  useEffect(() => {
    const imageAttachments = currentMessages
      .flatMap((messageItem) => messageItem.attachments || [])
      .filter((attachment) => attachment.kind === 'image')
    const imageIds = new Set(imageAttachments.map((attachment) => attachment.id))
    const nextUrls = { ...messageAttachmentPreviewUrlsRef.current }
    let changed = false

    Object.entries(nextUrls).forEach(([attachmentId, url]) => {
      if (imageIds.has(attachmentId)) return
      URL.revokeObjectURL(url)
      delete nextUrls[attachmentId]
      changed = true
    })

    if (changed) {
      messageAttachmentPreviewUrlsRef.current = nextUrls
      setMessageAttachmentPreviewUrls(nextUrls)
    }

    imageAttachments.forEach((attachment) => {
      if (messageAttachmentPreviewUrlsRef.current[attachment.id]) return
      void window.api
        .readFile(attachment.path)
        .then((bytes) => {
          if (messageAttachmentPreviewUrlsRef.current[attachment.id]) return
          const arrayBuffer = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(arrayBuffer).set(bytes)
          const blob = new Blob([arrayBuffer], { type: attachment.mimeType || 'image/png' })
          const url = URL.createObjectURL(blob)
          messageAttachmentPreviewUrlsRef.current = {
            ...messageAttachmentPreviewUrlsRef.current,
            [attachment.id]: url
          }
          setMessageAttachmentPreviewUrls(messageAttachmentPreviewUrlsRef.current)
        })
        .catch(() => undefined)
    })
  }, [currentMessages])

  useEffect(() => {
    return () => {
      Object.values(messageAttachmentPreviewUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url)
      )
      messageAttachmentPreviewUrlsRef.current = {}
    }
  }, [])

  const saveComposerDraftForPartner = useCallback(
    (partnerId: string | null, draft: ComposerDraftValue): void => {
      if (!partnerId) return
      if (isComposerDraftEmpty(draft)) {
        delete composerDraftByPartnerIdRef.current[partnerId]
        return
      }
      composerDraftByPartnerIdRef.current[partnerId] = draft
    },
    []
  )

  const applyComposerDraft = useCallback((draft: ComposerDraftValue, reason: string): void => {
    composerDraftValueRef.current = draft
    setInput(draft.input)
    setComposerContentNodes(draft.contentNodes)
    setSelectedReferences(draft.selectedReferences)
    setAttachments(draft.attachments || [])
    setAssetBucketId(draft.assetBucketId || null)
    composerDraftVersionRef.current += 1
    setComposerDraftKey(`${reason}:${composerDraftVersionRef.current}`)
  }, [])

  const applyPartnerUiState = useCallback(
    (key: string, persisted: PartnerUiStateV1 | null): void => {
      const state = persisted || createDefaultPartnerUiState(modelSelectionRef.current)
      const draft = state.composer.draft
      composerAiPreferenceRef.current = state.composer.aiPreference
      composerExecutionPermissionRef.current =
        state.composer.executionPermission === 'full_access' ? 'full_access' : 'review'
      modelSelectionRef.current = state.composer.modelSelection
      setComposerAiPreference(state.composer.aiPreference)
      setComposerExecutionPermission(composerExecutionPermissionRef.current)
      setModelSelection(state.composer.modelSelection)
      applyComposerDraft(draft, `restore:${key}`)

      const workspace: WorkbenchTabWorkspaceState = {
        tabs: state.panel.tabs as WorkbenchResourceTab[],
        activeTabId: state.panel.activeTabId,
        panelCollapsed: state.panel.collapsed
      }
      tabWorkspacesRef.current = { ...tabWorkspacesRef.current, [key]: workspace }
      setTabWorkspaces(tabWorkspacesRef.current)
      panelFallbackByKeyRef.current[key] = state.panel.fallbackState as WorkbenchContentPanelState
      const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId)
      const nextPanel =
        activeTab?.state || (state.panel.fallbackState as WorkbenchContentPanelState)
      contentPanelRef.current = nextPanel
      contentPanelCollapsedRef.current = state.panel.collapsed
      setContentPanel(nextPanel)
      setContentPanelCollapsed(state.panel.collapsed)
      if (!state.panel.collapsed) {
        restoreContentPanelWithoutAnimationRef.current = true
        setContentPanelShellMounted(true)
        setContentPanelShellVisible(true)
        if (nextPanel.kind === 'browser') {
          setBrowserPresentationEnabled(true)
        }
      }
      uiStateReadyKeyRef.current = key
      setUiStateReadyKey(key)
    },
    [applyComposerDraft]
  )

  const setPartnerRunningState = useCallback((partnerId: string, isRunning: boolean): void => {
    setPartners((items) =>
      items.map((item) => (item.id === partnerId ? { ...item, isRunning } : item))
    )
  }, [])

  useEffect(() => {
    const targetWindow = window as WorkbenchE2EWindow
    if (!window.api.isE2EMode()) return

    targetWindow.__NCURATOR_E2E_SET_WORKBENCH_DRAFT__ = (draft: ComposerDraftValue): void => {
      saveComposerDraftForPartner(currentPartnerIdRef.current, draft)
      applyComposerDraft(draft, 'e2e')
    }

    return () => {
      delete targetWindow.__NCURATOR_E2E_SET_WORKBENCH_DRAFT__
    }
  }, [applyComposerDraft, saveComposerDraftForPartner])

  const selectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) =>
        contentPanel.kind === 'file_preview'
          ? contentPanel.file.path
              .replace(/\\/g, '/')
              .startsWith(String(workspace.root_path || '').replace(/\\/g, '/'))
          : false
      ) ||
      workspaces[0] ||
      null,
    [contentPanel, workspaces]
  )
  const selectedWorkspaceName = useMemo(() => {
    if (!selectedWorkspace?.root_path) return null
    const parts = selectedWorkspace.root_path.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || selectedWorkspace.root_path
  }, [selectedWorkspace])

  const currentPartner = useMemo(
    () => partners.find((session) => session.id === currentPartnerId) || null,
    [currentPartnerId, partners]
  )
  const latestUserMessageId = useMemo(
    () => [...currentMessages].reverse().find((item) => item.role === 'user')?.id || null,
    [currentMessages]
  )
  const clearContextVisible = useMemo(
    () =>
      Boolean(currentPartnerId) &&
      currentMessages.length > 0 &&
      !aiRunId &&
      !pendingApprovalBatch,
    [aiRunId, currentMessages.length, currentPartnerId, pendingApprovalBatch]
  )
  const userMessageTimeIds = useMemo(
    () => collectUserMessageTimeIds(currentMessages),
    [currentMessages]
  )

  const currentApprovalItem = useMemo(() => {
    if (!pendingApprovalBatch) return null
    return pendingApprovalBatch.items[approvalCurrentIndex] || pendingApprovalBatch.items[0] || null
  }, [approvalCurrentIndex, pendingApprovalBatch])
  const composerSubmitDisabledReason = useMemo(() => {
    if (!input.trim()) return null
    if (!currentPartnerId) return '请先选择伙伴'
    if (switchingPartnerId) return '当前伙伴未就绪'
    if (!modelSelection.mainModel) return '请先选择主模型'
    return null
  }, [currentPartnerId, input, modelSelection.mainModel, switchingPartnerId])

  const approvalSubmitDisabled = useMemo(() => {
    if (!currentApprovalItem || approvalSubmitting) return true
    return (approvalDraftDecisions[currentApprovalItem.itemId]?.message || '').trim().length === 0
  }, [approvalDraftDecisions, approvalSubmitting, currentApprovalItem])

  const scrollToBottom = (force = false): void => {
    if (!force && !shouldAutoScrollRef.current) return
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const scrollElement = scrollRef.current
      scrollFrameRef.current = null
      if (!scrollElement) return
      scrollElement.scrollTop = scrollElement.scrollHeight
    })
  }

  const loadOlderMessages = useCallback(async (): Promise<void> => {
    if (
      !currentPartnerId ||
      !hasMoreMessagesBefore ||
      loadingOlderMessages ||
      switchingPartnerId ||
      currentMessages.length === 0
    ) {
      return
    }
    const beforeTimestamp = currentMessages[0]?.timestamp
    if (!beforeTimestamp) return
    setLoadingOlderMessages(true)
    const requestPartnerId = currentPartnerId
    try {
      const opened = await window.api.partnerOpen({
        partnerId: requestPartnerId,
        limit: 50,
        beforeTimestamp
      })
      if (currentPartnerId !== requestPartnerId) return
      setHasMoreMessagesBefore(opened.hasMoreBefore)
      setCurrentMessages((previous) => appendMessagesDedupe(opened.messages, previous))
    } catch (error) {
      console.error('Failed to load older messages', error)
    } finally {
      if (currentPartnerId === requestPartnerId) setLoadingOlderMessages(false)
    }
  }, [
    currentMessages,
    currentPartnerId,
    hasMoreMessagesBefore,
    loadingOlderMessages,
    switchingPartnerId
  ])

  const scrollMessageIntoDocumentView = useCallback((element: HTMLElement): void => {
    const scroller = scrollRef.current
    if (!scroller) return
    const scrollerRect = scroller.getBoundingClientRect()
    const targetRect = element.getBoundingClientRect()
    const nextTop = Math.max(0, scroller.scrollTop + (targetRect.top - scrollerRect.top))
    if (Math.abs(scroller.scrollTop - nextTop) < 2) return
    scroller.scrollTo({ top: nextTop, behavior: 'smooth' })
  }, [])

  const scrollToOldestMessageOfDay = useCallback((dayStart: number, messages: ChatMessage[]): boolean => {
    const dayEnd = dayStart + DAY_MS
    const ofDay = messages.filter(
      (item) => item.timestamp >= dayStart && item.timestamp < dayEnd
    )
    if (ofDay.length === 0) return false
    const oldest = ofDay.reduce((current, item) =>
      item.timestamp < current.timestamp ? item : current
    )
    const element = document.querySelector(`[data-message-id="${oldest.id}"]`)
    if (!(element instanceof HTMLElement)) return false
    shouldAutoScrollRef.current = false
    scrollMessageIntoDocumentView(element)
    return true
  }, [scrollMessageIntoDocumentView])

  const jumpToTimelineDay = useCallback(
    (dayStart: number): void => {
      setActiveTimelineDayStart(dayStart)
      if (scrollToOldestMessageOfDay(dayStart, currentMessages)) return
      if (!hasMoreMessagesBefore || !currentPartnerId) return
      pendingTimelineJumpDayRef.current = dayStart
      void loadOlderMessages()
    },
    [
      currentMessages,
      currentPartnerId,
      hasMoreMessagesBefore,
      loadOlderMessages,
      scrollToOldestMessageOfDay
    ]
  )

  const handleTimelineNodeSelect = useCallback(
    (node: TimelineNode): void => {
      jumpToTimelineDay(node.jumpDayStart)
    },
    [jumpToTimelineDay]
  )

  const resolveActiveDayFromScroll = useCallback((): number | null => {
    const scrollElement = scrollRef.current
    if (!scrollElement || currentMessages.length === 0) return null
    const containerTop = scrollElement.getBoundingClientRect().top
    let active: ChatMessage | null = null
    for (const messageItem of currentMessages) {
      const element = document.querySelector(`[data-message-id="${messageItem.id}"]`)
      if (!(element instanceof HTMLElement)) continue
      const rect = element.getBoundingClientRect()
      if (rect.top <= containerTop + 12) {
        active = messageItem
        continue
      }
      if (!active) active = messageItem
      break
    }
    return active ? startOfLocalDay(active.timestamp) : null
  }, [currentMessages])

  useEffect(() => {
    const dayStart = pendingTimelineJumpDayRef.current
    if (dayStart == null) return
    if (scrollToOldestMessageOfDay(dayStart, currentMessages)) {
      pendingTimelineJumpDayRef.current = null
      return
    }
    if (hasMoreMessagesBefore && !loadingOlderMessages) {
      void loadOlderMessages()
      return
    }
    pendingTimelineJumpDayRef.current = null
  }, [
    currentMessages,
    hasMoreMessagesBefore,
    loadOlderMessages,
    loadingOlderMessages,
    scrollToOldestMessageOfDay
  ])

  const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const scrollElement = event.currentTarget
    const distanceToBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
    shouldAutoScrollRef.current = distanceToBottom <= SCROLL_BOTTOM_TOLERANCE
    if (scrollElement.scrollTop <= 80) {
      void loadOlderMessages()
    }
    const nextActiveDay = resolveActiveDayFromScroll()
    if (nextActiveDay != null) setActiveTimelineDayStart(nextActiveDay)
  }

  const emitSuccessMessage = useCallback(
    (content: string): void => {
      if (typeof message.success === 'function') {
        message.success(content)
        return
      }
      if (typeof message.open === 'function') {
        message.open({ type: 'success', content })
      }
    },
    [message]
  )

  const emitErrorMessage = useCallback(
    (content: string): void => {
      const normalized = normalizeUserFacingError(content)
      if (typeof message.error === 'function') {
        message.error(normalized)
        return
      }
      if (typeof message.open === 'function') {
        message.open({ type: 'error', content: normalized })
      }
    },
    [message]
  )

  const emitInfoMessage = useCallback(
    (content: string): void => {
      if (typeof message.info === 'function') {
        message.info(content)
        return
      }
      if (typeof message.open === 'function') {
        message.open({ type: 'info', content })
      }
    },
    [message]
  )

  const updateCurrentTabWorkspace = useCallback(
    (updater: (current: WorkbenchTabWorkspaceState) => WorkbenchTabWorkspaceState): void => {
      setTabWorkspaces((current) => ({
        ...current,
        [tabWorkspaceKey]: updater(current[tabWorkspaceKey] || EMPTY_TAB_WORKSPACE)
      }))
    },
    [tabWorkspaceKey]
  )

  const setPanelCollapsedForSession = useCallback(
    (sessionKey: string, collapsed: boolean): void => {
      setTabWorkspaces((current) => ({
        ...current,
        [sessionKey]: {
          ...(current[sessionKey] || EMPTY_TAB_WORKSPACE),
          panelCollapsed: collapsed
        }
      }))
    },
    []
  )

  const captureBrowserTransition = useCallback(async (tabId: string): Promise<string | null> => {
    const response = await Promise.race([
      window.api.browserPanelCapture({ tabId }),
      new Promise<{ success: false }>((resolve) =>
        window.setTimeout(() => resolve({ success: false }), 180)
      )
    ])
    const dataUrl =
      response.success && 'dataUrl' in response && response.dataUrl ? response.dataUrl : null
    setBrowserTransitionImage(dataUrl ? { tabId, dataUrl } : null)
    return dataUrl
  }, [])

  const collapseContentPanel = useCallback((): void => {
    const sessionKey = tabWorkspaceKey
    void (async () => {
      // Keep the ref in sync before any await so a concurrent session switch / flush
      // persists the collapsed intent instead of the stale expanded value.
      contentPanelCollapsedRef.current = true
      if (contentPanel.kind === 'browser') {
        await captureBrowserTransition(contentPanel.browserTabId)
      } else {
        setBrowserTransitionImage(null)
      }
      setPanelCollapsedForSession(sessionKey, true)
      if ((currentPartnerIdRef.current || '') !== sessionKey) {
        setBrowserTransitionImage(null)
        return
      }
      setBrowserPresentationEnabled(false)
      void window.api.browserPanelHide()
      setContentPanelCollapsed(true)
    })()
  }, [captureBrowserTransition, contentPanel, setPanelCollapsedForSession, tabWorkspaceKey])

  const collapseContentPanelRef = useRef(collapseContentPanel)
  collapseContentPanelRef.current = collapseContentPanel

  const applyContentPanelRatioCss = useCallback((ratio: number): void => {
    const next = clampWorkbenchContentPanelRatio(ratio)
    contentPanelRatioRef.current = next
    mainSplitRef.current?.style.setProperty('--nc-content-panel-ratio', String(next))
  }, [])

  const applyContentPanelWidthPx = useCallback((widthPx: number): void => {
    contentPanelWidthPxRef.current = widthPx
    mainSplitRef.current?.style.setProperty('--nc-content-panel-width', `${Math.max(0, widthPx)}px`)
  }, [])

  const setContentPanelResizeGuide = useCallback((active: boolean, x?: number): void => {
    const guide = contentPanelResizeGuideRef.current
    if (!guide) return
    guide.dataset.active = active ? 'true' : 'false'
    if (typeof x === 'number') {
      guide.style.left = `${Math.round(x)}px`
    }
  }, [])

  const syncContentPanelWidthFromRatio = useCallback((): void => {
    const available = mainSplitRef.current?.clientWidth ?? 0
    const width = resolveWorkbenchContentPanelWidth(available, contentPanelRatioRef.current)
    applyContentPanelWidthPx(width)
    applyContentPanelRatioCss(contentPanelRatioRef.current)
  }, [applyContentPanelRatioCss, applyContentPanelWidthPx])

  const enterContentPanelPixelResize = useCallback((): void => {
    mainSplitRef.current?.setAttribute('data-panel-resize', 'pixel')
  }, [])

  const exitContentPanelPixelResize = useCallback((): void => {
    mainSplitRef.current?.removeAttribute('data-panel-resize')
  }, [])

  const expandContentPanel = useCallback((): void => {
    setPanelCollapsedForSession(tabWorkspaceKey, false)
    setContentPanelCollapsed(false)
  }, [setPanelCollapsedForSession, tabWorkspaceKey])

  const restoreCollapsedContentPanel = useCallback((): void => {
    // A collapsed BrowserView is detached from the native window, where capturePage can hang.
    // The transition image is captured before collapsing, so restoring needs no second capture.
    setBrowserTransitionImage(null)
    setContentPanelShellMounted(true)
    expandContentPanel()
  }, [expandContentPanel])

  const showContentPanel = useCallback(
    (nextState: WorkbenchContentPanelState): void => {
      if (contentPanel.kind === 'browser') {
        void window.api.browserPanelHide()
      }
      setContentPanel(nextState)
      if (nextState.kind === 'empty') {
        panelFallbackByKeyRef.current[tabWorkspaceKey] = nextState
        updateCurrentTabWorkspace((current) => ({ ...current, activeTabId: null }))
      }
      expandContentPanel()
    },
    [contentPanel.kind, expandContentPanel, tabWorkspaceKey, updateCurrentTabWorkspace]
  )

  const openScheduledTasks = useCallback((): void => {
    setScheduledTasksActive(true)
  }, [])

  const refreshScheduledTaskEnabledCount = useCallback(async (): Promise<void> => {
    try {
      const tasks = await window.api.scheduledTaskList()
      setScheduledTaskEnabledCount(tasks.reduce((count, task) => count + (task.enabled ? 1 : 0), 0))
    } catch (error) {
      console.error('[WORKBENCH] scheduled task count failed:', error)
      setScheduledTaskEnabledCount(0)
    }
  }, [])

  useEffect(() => {
    void refreshScheduledTaskEnabledCount()
  }, [refreshScheduledTaskEnabledCount])

  const openResourceTab = useCallback(
    (tab: WorkbenchResourceTab): void => {
      const switchingAwayFromBrowser =
        contentPanel.kind === 'browser' &&
        (tab.kind !== 'browser' || tab.browserTabId !== contentPanel.browserTabId)
      if (switchingAwayFromBrowser) {
        void window.api.browserPanelHide()
      }
      updateCurrentTabWorkspace((current) => {
        const existingIndex = current.tabs.findIndex((item) => item.id === tab.id)
        const launcherIndex =
          tab.id !== 'file:launcher' &&
          tab.kind === 'file' &&
          current.activeTabId === 'file:launcher'
            ? current.tabs.findIndex((item) => item.id === 'file:launcher')
            : -1
        const tabs =
          launcherIndex >= 0
            ? current.tabs.map((item, index) => (index === launcherIndex ? tab : item))
            : existingIndex < 0
              ? [...current.tabs, tab]
              : current.tabs.map((item, index) => (index === existingIndex ? tab : item))
        return { ...current, tabs, activeTabId: tab.id, panelCollapsed: false }
      })
      setContentPanel(tab.state)
      expandContentPanel()
      // 面板已展开时 contentPanelCollapsed 不变，不会重跑呈现动画；切到浏览器时必须显式打开呈现。
      if (tab.kind === 'browser' && !contentPanelCollapsedRef.current) {
        setBrowserPresentationEnabled(true)
      }
    },
    [contentPanel, expandContentPanel, updateCurrentTabWorkspace]
  )

  const openBrowserTab = useCallback(
    async (existingTabId?: string): Promise<void> => {
      const ownerId = currentPartnerIdRef.current
      if (!ownerId && !existingTabId) {
        emitErrorMessage('请先选择伙伴')
        return
      }
      const response = existingTabId
        ? await window.api.browserPanelStateGet({ tabId: existingTabId })
        : await window.api.browserTabCreate({ ownerId: ownerId as string })
      if (!response.success || !response.state) {
        emitErrorMessage(response.error || '无法创建浏览器标签')
        return
      }
      const browser = response.state
      openResourceTab({
        id: `browser:${browser.id}`,
        kind: 'browser',
        browserTabId: browser.id,
        title: browser.title || '新标签页',
        state: {
          kind: 'browser',
          title: browser.title || '新标签页',
          browserTabId: browser.id
        }
      })
    },
    [emitErrorMessage, openResourceTab]
  )

  const updateBackgroundPanelState = useCallback(
    async (
      partnerId: string,
      update: (state: PartnerUiStateV1) => PartnerUiStateV1
    ): Promise<void> => {
      try {
        const opened = await window.api.partnerOpen({ partnerId, limit: 1 })
        const currentState =
          opened.uiState ||
          createDefaultPartnerUiState({ mainModel: null })
        await persistUiStateForKey(partnerId, update(currentState))
      } catch (error) {
        console.error('Failed to update background session UI state', error)
      }
    },
    [persistUiStateForKey]
  )

  const persistBackgroundBrowserTab = useCallback(
    (partnerId: string, browserTabId: string): void => {
      void window.api.browserPanelStateGet({ tabId: browserTabId }).then((response) => {
        if (!response.success || !response.state) return
        const browser = response.state
        const title = browser.title || browser.url || '新标签页'
        void updateBackgroundPanelState(partnerId, (state) => {
          const resourceId = `browser:${browser.id}`
          const tab: WorkbenchResourceTab = {
            id: resourceId,
            kind: 'browser',
            browserTabId: browser.id,
            title,
            state: { kind: 'browser', title, browserTabId: browser.id }
          }
          const tabs = state.panel.tabs.some((item) => item.id === resourceId)
            ? state.panel.tabs.map((item) => (item.id === resourceId ? tab : item))
            : [...state.panel.tabs, tab]
          return {
            ...state,
            panel: { ...state.panel, tabs, activeTabId: resourceId, collapsed: false }
          }
        })
      })
    },
    [updateBackgroundPanelState]
  )

  const showApplyWorkspace = useCallback(
    (record: AiFileChangeRecord): void => {
      openResourceTab({
        id: getFileTabId(record.path, detectRendererPlatform()),
        kind: 'file',
        title: record.fileName || getFileTabTitle(record.path),
        filePath: record.path,
        state: {
          kind: 'apply_workspace',
          title: '修改的文件',
          applyId: record.id
        }
      })
    },
    [openResourceTab]
  )

  const resetApplyWorkspaceState = (): void => {
    setActiveApplyRecord(null)
    setApplyLoading(false)
    setApplyReverting(false)
    setApplyRevertConfirm(null)
  }

  const updateTurnForRun = (
    runId: string,
    updater: (current: AssistantTurnViewModel) => AssistantTurnViewModel
  ): void => {
    const messageId = activeRunMessageIdsRef.current[runId]
    if (!messageId) return
    setAssistantTurns((previous) => {
      const current = previous[messageId] || createAssistantTurn(messageId)
      return {
        ...previous,
        [messageId]: updater(current)
      }
    })
  }

  const openPathOrNotify = useCallback(
    async (filePath: string): Promise<boolean> => {
      try {
        const result = await window.api.openPath(filePath)
        if (!result.success) emitErrorMessage(result.error || '打开失败')
        return result.success
      } catch (error) {
        emitErrorMessage(error instanceof Error ? error.message : '打开失败')
        return false
      }
    },
    [emitErrorMessage]
  )

  const revealPathOrNotify = useCallback(
    async (filePath: string): Promise<void> => {
      const result = await window.api.revealPath(filePath)
      if (!result.success) emitErrorMessage(result.error || '定位失败')
    },
    [emitErrorMessage]
  )

  const loadPartners = useCallback(async (): Promise<PartnerListItem[]> => {
    try {
      const list = await window.api.partnerList()
      setPartners(list)
      return list
    } catch (error) {
      console.error('Failed to load partners', error)
      return []
    } finally {
      setPartnersListHydrated(true)
    }
  }, [])

  const hydratePartnerView = (
    messages: ChatMessage[],
    runSnapshots: PartnerRunSnapshot[],
    activeRuns: PartnerRunSnapshot[]
  ): void => {
    assistantArtifactsRef.current = {}
    activeRunMessageIdsRef.current = {}
    const runAssistantMessageIds = new Set(
      runSnapshots.map((snapshot) => snapshot.run.assistantMessageId)
    )
    setAssistantTurns(() => {
      const nextTurns: Record<string, AssistantTurnViewModel> = {}
      for (const message of messages) {
        if (message.role === 'assistant' && !runAssistantMessageIds.has(message.id)) {
          nextTurns[message.id] = buildSearchTurnFromProjectedMessage(message)
        }
      }
      const activeRunIds = new Set(activeRuns.map((item) => item.run.id))
      for (const runSnapshot of runSnapshots) {
        activeRunPartnerIdsRef.current[runSnapshot.run.id] = runSnapshot.run.partnerId
        if (activeRunIds.has(runSnapshot.run.id)) {
          activeRunMessageIdsRef.current[runSnapshot.run.id] = runSnapshot.run.assistantMessageId
        }
        const turn = buildAssistantTurnFromRunSnapshot(runSnapshot)
        const projectedMessage = messages.find(
          (message) => message.id === runSnapshot.run.assistantMessageId
        )
        if (projectedMessage?.linkAccess !== undefined) {
          turn.linkAccess = projectedMessage.linkAccess
        }
        nextTurns[runSnapshot.run.assistantMessageId] = turn
        if (runSnapshot.run.artifacts && runSnapshot.run.artifacts.length > 0) {
          assistantArtifactsRef.current[runSnapshot.run.assistantMessageId] =
            runSnapshot.run.artifacts
        }
      }
      return nextTurns
    })
    const visibleActiveRun =
      activeRuns.find((item) => item.run.status === 'running') || activeRuns[0]
    setAiRunId(visibleActiveRun?.run.id || null)
    setLoading(Boolean(visibleActiveRun && visibleActiveRun.run.status === 'running'))
    const approval =
      activeRuns.find((item) => item.pendingApproval && !item.pendingApproval.internal)
        ?.pendingApproval || null
    setPendingApprovalBatch(approval)
    setApprovalCurrentIndex(0)
    setApprovalDraftDecisions({})
    setApprovalSubmitting(false)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
  }

  const loadPartnerOpen = async (partnerId: string, requestId: number): Promise<void> => {
    try {
      const opened = await window.api.partnerOpen({ partnerId, limit: 50 })
      if (partnerSwitchRequestRef.current !== requestId) return
      applyPartnerUiState(partnerId, opened.uiState || null)
      setActiveTimelineDayStart(null)
      pendingTimelineJumpDayRef.current = null
      const restoredActiveTab = opened.uiState?.panel.tabs.find(
        (tab) => tab.id === opened.uiState?.panel.activeTabId
      )
      if (
        restoredActiveTab?.state.kind === 'apply_workspace' &&
        restoredActiveTab.state.applyId &&
        !restoredActiveTab.state.applyId.startsWith('session:')
      ) {
        void loadApplyRecordRef.current({ applyId: restoredActiveTab.state.applyId })
      }
      setCurrentMessages(opened.messages)
      setHasMoreMessagesBefore(opened.hasMoreBefore)
      hydratePartnerView(opened.messages, opened.activeRuns, opened.activeRuns)
      setSwitchingPartnerId(null)

      void window.api.partnerRunSummaries({ partnerId }).then((summary) => {
        if (partnerSwitchRequestRef.current !== requestId) return
        hydratePartnerView(opened.messages, summary.runs, opened.activeRuns)
        void hydrateFileChangeTargetsForPartner(partnerId, opened.messages)
      })
    } catch (error) {
      if (partnerSwitchRequestRef.current === requestId) setSwitchingPartnerId(null)
      console.error('Failed to open session', error)
    }
  }

  const refreshContextUsage = useCallback(async (partnerId: string | null): Promise<void> => {
    if (!partnerId) {
      setContextUsage(null)
      return
    }
    try {
      const response = await window.api.aiContextUsageGet({ partnerId })
      if (!response.success) return
      setContextUsage({
        contextWindowTokens: response.contextWindowTokens || 200000,
        usedContextTokens: response.usedContextTokens || 0,
        ratio: response.ratio || 0,
        updatedAt: response.updatedAt || Date.now()
      })
    } catch {
      // Context usage is advisory; failures should not block chat.
    }
  }, [])

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    try {
      const response = await window.api.workspaceList()
      setWorkspaces(response.items)
    } catch (error) {
      console.error('Failed to load workspaces', error)
    }
  }, [])

  const loadModelConfigs = useCallback(async (): Promise<void> => {
    try {
      const [list, freeSnapshot] = await Promise.all([
        window.api.llmConfigList(),
        window.api.freeModelsGet().catch(() => ({
          updatedAt: null,
          fetchedAt: null,
          models: []
        }))
      ])
      const freeModels = freeSnapshot.models
      setModelConfigs(list)
      if (list.length === 0) {
        setModelListsByConfigId({})
        const resolveModel = (
          model: WorkbenchModelSelection['mainModel']
        ): WorkbenchModelSelection['mainModel'] =>
          resolveSelectedWorkbenchModel({
            configs: [],
            modelListsByConfigId: {},
            selected: model,
            freeModels
          })
        const firstModel = pickFallbackWorkbenchModel({
          configs: [],
          modelListsByConfigId: {},
          freeModels
        })
        const nextSelection: WorkbenchModelSelection = {
          mainModel: resolveModel(modelSelectionRef.current.mainModel) || firstModel
        }
        modelSelectionRef.current = nextSelection
        setModelSelection(nextSelection)
        return
      }

      const entries = await Promise.all(
        list.map(async (config) => {
          try {
            const response = await window.api.llmConfigModelList(config.id)
            const items = response.success ? response.items : []
            return [config.id, items] as const
          } catch {
            return [config.id, []] as const
          }
        })
      )
      const nextLists = Object.fromEntries(entries)
      setModelListsByConfigId(nextLists)

      const resolveModel = (
        model: WorkbenchModelSelection['mainModel']
      ): WorkbenchModelSelection['mainModel'] =>
        resolveSelectedWorkbenchModel({
          configs: list,
          modelListsByConfigId: nextLists,
          selected: model,
          freeModels
        })
      const firstModel = pickFallbackWorkbenchModel({
        configs: list,
        modelListsByConfigId: nextLists,
        freeModels
      })
      const nextSelection: WorkbenchModelSelection = {
        mainModel: resolveModel(modelSelectionRef.current.mainModel) || firstModel
      }
      modelSelectionRef.current = nextSelection
      setModelSelection(nextSelection)
    } catch (error) {
      console.error('Failed to load llm configs', error)
      setModelConfigs([])
      setModelListsByConfigId({})
      setModelSelection({ mainModel: null })
    } finally {
      setModelCatalogLoaded(true)
    }
  }, [])

  const refreshModelLists = useCallback(async (): Promise<void> => {
    try {
      const entries = await Promise.all(
        modelConfigs.map(async (config) => {
          try {
            const response = await window.api.llmConfigModelList(config.id)
            return [config.id, response.success ? response.items : []] as const
          } catch {
            return [config.id, []] as const
          }
        })
      )
      setModelListsByConfigId(Object.fromEntries(entries))
    } catch (error) {
      console.error('Failed to refresh llm model lists', error)
    }
  }, [modelConfigs])

  useEffect(() => {
    const key = currentPartnerIdRef.current || ''
    if (!modelCatalogLoaded || uiStateReadyKeyRef.current !== key) return
    const resolveModel = (
      selected: WorkbenchModelSelection['mainModel']
    ): WorkbenchModelSelection['mainModel'] =>
      resolveSelectedWorkbenchModel({
        configs: modelConfigs,
        modelListsByConfigId,
        selected
      })
    const fallback = pickFallbackWorkbenchModel({
      configs: modelConfigs,
      modelListsByConfigId
    })
    const nextSelection: WorkbenchModelSelection = {
      mainModel: resolveModel(modelSelection.mainModel) || fallback
    }
    if (JSON.stringify(nextSelection) === JSON.stringify(modelSelection)) return
    modelSelectionRef.current = nextSelection
    setModelSelection(nextSelection)
    void persistUiStateForKey(key, {
      ...buildUiStateForKey(key),
      composer: { ...buildUiStateForKey(key).composer, modelSelection: nextSelection }
    })
  }, [
    buildUiStateForKey,
    modelCatalogLoaded,
    modelConfigs,
    modelListsByConfigId,
    modelSelection,
    persistUiStateForKey
  ])

  useEffect(() => {
    const key = currentPartnerIdRef.current || ''
    if (uiStateReadyKeyRef.current !== key || attachments.length === 0) return
    let cancelled = false
    const snapshot = attachments
    void Promise.all(
      snapshot.map(async (attachment) => ({
        attachment,
        exists: await window.api.fileExists(attachment.path)
      }))
    ).then((checked) => {
      if (cancelled || (currentPartnerIdRef.current || '') !== key) return
      const missingIds = new Set(
        checked.filter((item) => !item.exists).map((item) => item.attachment.id)
      )
      if (missingIds.size === 0) return
      setAttachments((current) => current.filter((attachment) => !missingIds.has(attachment.id)))
      if (!missingAttachmentNotifiedRef.current.has(key)) {
        missingAttachmentNotifiedRef.current.add(key)
        message.warning('部分附件文件已不存在，已从当前会话移除')
      }
    })
    return () => {
      cancelled = true
    }
  }, [attachments, message])

  const handleModelSelectionChange = useCallback(
    (selection: WorkbenchModelSelection): void => {
      uiStateInteractionVersionRef.current += 1
      modelSelectionRef.current = selection
      setModelSelection(selection)
      void persistCurrentUiStateNow({ requireReady: false })
    },
    [persistCurrentUiStateNow]
  )

  const handleAiPreferenceChange = useCallback(
    (preference: WorkbenchAiPreference): void => {
      uiStateInteractionVersionRef.current += 1
      composerAiPreferenceRef.current = preference
      setComposerAiPreference(preference)
      void persistCurrentUiStateNow({ requireReady: false })
    },
    [persistCurrentUiStateNow]
  )

  const handleExecutionPermissionChange = useCallback(
    (permission: WorkbenchExecutionPermission): void => {
      if (
        permission === 'full_access' &&
        composerExecutionPermissionRef.current !== 'full_access'
      ) {
        setFullAccessConfirmOpen(true)
        return
      }
      uiStateInteractionVersionRef.current += 1
      composerExecutionPermissionRef.current = permission
      setComposerExecutionPermission(permission)
      void persistCurrentUiStateNow({ requireReady: false })
    },
    [persistCurrentUiStateNow]
  )

  const handleConfirmFullAccess = useCallback((): void => {
    setFullAccessConfirmOpen(false)
    uiStateInteractionVersionRef.current += 1
    composerExecutionPermissionRef.current = 'full_access'
    setComposerExecutionPermission('full_access')
    void persistCurrentUiStateNow({ requireReady: false })
  }, [persistCurrentUiStateNow])

  const handleCancelFullAccess = useCallback((): void => {
    setFullAccessConfirmOpen(false)
  }, [])

  const loadApplyRecord = async (input: {
    applyId: string
    detail?: AiFileChangeRecord | null
    openWorkspace?: boolean
  }): Promise<void> => {
    setApplyLoading(true)
    try {
      let nextRecord = input.detail || null
      if (!nextRecord) {
        const fileChange = await window.api.aiFileChangeGet({ changeId: input.applyId })
        nextRecord = fileChange.record || null
      }
      if (!nextRecord) {
        setActiveApplyRecord(null)
        return
      }

      setActiveApplyRecord(nextRecord)
      if (isCurrentFileChangeRunScope(fileChangeRunScopeRef.current, nextRecord)) {
        setFileChangeRecords((current) =>
          current.map((record) => (record.id === nextRecord.id ? nextRecord : record))
        )
      }

      if (!isCurrentFileChangeRunScope(fileChangeRunScopeRef.current, nextRecord)) {
        void loadFileChangesForPartnerRef.current(nextRecord.partnerId, nextRecord.runId, {
          preferredApplyId: nextRecord.id,
          skipApplyRecordReload: true
        })
      }

      if (input.openWorkspace) {
        showApplyWorkspace(nextRecord)
      }
    } catch (error) {
      console.error('Failed to load apply record', error)
      setActiveApplyRecord(null)
    } finally {
      setApplyLoading(false)
    }
  }
  loadApplyRecordRef.current = loadApplyRecord

  const loadFileChangesForPartner = async (
    partnerId: string,
    runId: string,
    options?: {
      preferredApplyId?: string | null
      autoOpen?: boolean
      forceOpenWorkspace?: boolean
      skipApplyRecordReload?: boolean
      notifyNoEffectiveChange?: boolean
    }
  ): Promise<void> => {
    const requestId = fileChangeLoadRequestRef.current + 1
    fileChangeLoadRequestRef.current = requestId
    const scope = createFileChangeRunScope({ partnerId, runId })
    fileChangeRunScopeRef.current = scope
    try {
      const shouldWaitForRecords =
        Boolean(options?.forceOpenWorkspace) || Boolean(options?.preferredApplyId)
      const maxAttempts = shouldWaitForRecords ? 6 : 1
      let allRecords: AiFileChangeRecord[] = []
      let activeRecords: AiFileChangeRecord[] = []

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await window.api.aiFileChangeList(createFileChangeListRequest(scope))
        const listedItems = sortFileChangeRecords(
          filterFileChangeRecordsForScope(response.items, scope)
        )
        const noEffectiveChangeRecords = listedItems.filter(
          (item) => item.status === 'failed' && item.error === NO_EFFECTIVE_FILE_CHANGE_MESSAGE
        )
        if (options?.notifyNoEffectiveChange) {
          noEffectiveChangeRecords.forEach((record) => {
            if (notifiedNoEffectiveChangeIdsRef.current.has(record.id)) return
            notifiedNoEffectiveChangeIdsRef.current.add(record.id)
            emitInfoMessage(NO_EFFECTIVE_FILE_CHANGE_MESSAGE)
          })
        }
        const nextItems = listedItems.filter(
          (item) => item.status !== 'failed' || item.error !== NO_EFFECTIVE_FILE_CHANGE_MESSAGE
        )
        allRecords = nextItems
        activeRecords = filterVisibleFileChangeRecords(
          nextItems,
          getUserAttachmentPaths(currentMessages)
        ).filter((item) => ACTIVE_FILE_CHANGE_STATUSES.has(item.status))

        const missingPreferred =
          options?.preferredApplyId !== undefined &&
          options.preferredApplyId !== null &&
          !listedItems.some((record) => record.id === options.preferredApplyId)
        if (!missingPreferred) break
        if (attempt < maxAttempts - 1) await delay(150)
      }

      const applyTargetsByRunId = groupApplyTargetsByRunId(
        filterVisibleFileChangeRecords(allRecords, getUserAttachmentPaths(currentMessages))
      )
      if (fileChangeLoadRequestRef.current !== requestId) return
      setFileChangeRecords(allRecords)

      setAssistantTurns((previous) => {
        const nextTurns: Record<string, AssistantTurnViewModel> = { ...previous }
        Object.values(previous).forEach((turn) => {
          if (!turn.runId || turn.runId !== runId) return
          nextTurns[turn.messageId] = {
            ...turn,
            applyTargets: applyTargetsByRunId.get(turn.runId) || []
          }
        })
        return nextTurns
      })

      const preferredRecord = options?.preferredApplyId
        ? allRecords.find((record) => record.id === options.preferredApplyId) || null
        : null

      const nextSelectedRecord = preferredRecord || activeRecords[0] || null
      if (!nextSelectedRecord) {
        setActiveApplyRecord(null)
        setContentPanel((current) =>
          current.kind === 'apply_workspace' ? createEmptyPanel() : current
        )
        if (contentPanel.kind === 'apply_workspace') {
          collapseContentPanel()
        }
        return
      }

      const previewFileKey = contentPanel.kind === 'file_preview' ? contentPanel.file.path : null
      const panelCollapsed = contentPanelCollapsedRef.current
      if (options?.skipApplyRecordReload) {
        setActiveApplyRecord(nextSelectedRecord)
        if (
          options.forceOpenWorkspace ||
          (!panelCollapsed && contentPanel.kind === 'apply_workspace')
        ) {
          showApplyWorkspace(nextSelectedRecord)
        }
        return
      }

      const shouldOpenWorkspace =
        Boolean(options?.forceOpenWorkspace) ||
        (!panelCollapsed && contentPanel.kind === 'apply_workspace') ||
        (Boolean(options?.autoOpen) &&
          (contentPanel.kind === 'empty' ||
            (previewFileKey !== null && previewFileKey === nextSelectedRecord.path)))

      await loadApplyRecord({
        applyId: nextSelectedRecord.id,
        openWorkspace: shouldOpenWorkspace
      })
    } catch (error) {
      console.error('Failed to load file change records', error)
      setActiveApplyRecord(null)
      setFileChangeRecords([])
    }
  }
  loadFileChangesForPartnerRef.current = loadFileChangesForPartner

  const hydrateFileChangeTargetsForPartner = async (
    partnerId: string,
    messages = currentMessages
  ): Promise<void> => {
    try {
      const response = await window.api.aiFileChangeList({ partnerId })
      const applyTargetsByRunId = groupApplyTargetsByRunId(
        filterVisibleFileChangeRecords(
          sortFileChangeRecords(response.items),
          getUserAttachmentPaths(messages)
        )
      )
      setAssistantTurns((previous) => {
        const nextTurns: Record<string, AssistantTurnViewModel> = { ...previous }
        Object.values(previous).forEach((turn) => {
          if (!turn.runId) return
          nextTurns[turn.messageId] = {
            ...turn,
            applyTargets: applyTargetsByRunId.get(turn.runId) || []
          }
        })
        return nextTurns
      })
    } catch (error) {
      console.error('Failed to hydrate file change targets', error)
    }
  }

  const openExistingPartner = async (
    session: Partner,
    options?: { saveCurrentDraft?: boolean }
  ): Promise<void> => {
    setScheduledTasksActive(false)
    if (session.id === currentPartnerIdRef.current && !switchingPartnerId) return

    uiStateInteractionVersionRef.current += 1
    if (options?.saveCurrentDraft !== false) await flushCurrentUiState()

    const requestId = partnerSwitchRequestRef.current + 1
    partnerSwitchRequestRef.current = requestId
    uiStateReadyKeyRef.current = null
    setUiStateReadyKey(null)
    currentPartnerIdRef.current = session.id

    setCurrentPartnerId(session.id)
    setSwitchingPartnerId(session.id)
    setBrowserPresentationEnabled(false)
    void window.api.browserPanelHide()
    restoreContentPanelWithoutAnimationRef.current = false
    resetApplyWorkspaceState()

    await window.api.workbenchUiStateSave({
      activeViewKey: session.id
    })
    void loadPartnerOpen(session.id, requestId)
    setFileChangeRecords([])
    fileChangeRunScopeRef.current = null
    void refreshContextUsage(session.id)
  }

  const selectPartner = (session: PartnerListItem): void => {
    setPartners((items) =>
      items.map((item) => (item.id === session.id ? { ...item, hasUnreadCompletion: false } : item))
    )
    void window.api.partnerMarkViewed(session.id).then((response) => {
      if (!response.success) void loadPartners()
    })
    void openExistingPartner(session)
  }

  useEffect(() => {
    const openNotificationPartner = async (partnerId: string): Promise<void> => {
      const session = partners.find((item) => item.id === partnerId)
      if (session) {
        selectPartner(session)
        return
      }
      const loadedPartners = await loadPartners()
      const loadedSession = loadedPartners.find((item) => item.id === partnerId)
      if (loadedSession) selectPartner(loadedSession)
    }
    const pendingSessionId = window.sessionStorage.getItem('ncurator.pending-notification-partner')
    if (pendingSessionId) {
      window.sessionStorage.removeItem('ncurator.pending-notification-partner')
      void openNotificationPartner(pendingSessionId)
    }
    return window.api.onSystemNotificationOpenPartner(openNotificationPartner)
    // Session selection intentionally uses the current list captured by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners])

  const acknowledgeCurrentPartnerCompletion = useCallback((): void => {
    const sessionId = currentPartnerIdRef.current
    if (
      !sessionId ||
      !partners.some((session) => session.id === sessionId && session.hasUnreadCompletion)
    ) {
      return
    }

    setPartners((items) =>
      items.map((item) => (item.id === sessionId ? { ...item, hasUnreadCompletion: false } : item))
    )
    void window.api.partnerMarkViewed(sessionId).then((response) => {
      if (!response.success) void loadPartners()
    })
  }, [loadPartners, partners])

  useEffect(() => {
    const bootstrapInteractionVersion = uiStateInteractionVersionRef.current
    void (async () => {
      const [, , list, workbenchStateResponse] = await Promise.all([
        loadWorkspaces(),
        loadModelConfigs(),
        loadPartners(),
        window.api.workbenchUiStateGet()
      ])
      if (partnerListHydratedRef.current) return
      partnerListHydratedRef.current = true
      // A user may create or open a conversation before all startup requests resolve. In that
      // case the in-memory state is newer than the persisted startup snapshot.
      if (uiStateInteractionVersionRef.current !== bootstrapInteractionVersion) return
      const workbenchState = workbenchStateResponse.state
      const savedPartner = list.find((item) => item.id === workbenchState.activeViewKey)
      if (savedPartner) {
        await openExistingPartner(savedPartner, { saveCurrentDraft: false })
        return
      }
      if (list.length === 0) {
        currentPartnerIdRef.current = null
        setCurrentPartnerId(null)
        return
      }
      const firstPartner = list[0]
      if (firstPartner) await openExistingPartner(firstPartner, { saveCurrentDraft: false })
    })()
    // Initial bootstrap is intentionally explicit. Later list refreshes must not reopen partners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const refreshSources = (): void => {
      void loadWorkspaces()
    }
    const unsubscribe = window.api.sourceListRefresh(refreshSources)
    return () => {
      unsubscribe()
    }
  }, [loadWorkspaces])

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    contentPanelRatioRef.current = contentPanelRatio
    contentPanelCommittedRatioRef.current = contentPanelRatio
    window.localStorage.setItem(WORKBENCH_CONTENT_PANEL_RATIO_STORAGE_KEY, String(contentPanelRatio))
    applyContentPanelRatioCss(contentPanelRatio)
    if (contentPanelShellMounted && !contentPanelDragStartRef.current) {
      syncContentPanelWidthFromRatio()
    }
  }, [
    applyContentPanelRatioCss,
    contentPanelRatio,
    contentPanelShellMounted,
    syncContentPanelWidthFromRatio
  ])

  useEffect(() => {
    if (!contentPanelShellMounted) return
    // 只在挂载/展开时校准一次像素缓存；窗口缩放交给 CSS flex-basis 比例，避免每帧 JS 写宽。
    syncContentPanelWidthFromRatio()
  }, [contentPanelShellMounted, syncContentPanelWidthFromRatio])

  // 窗口 live-resize：标记 body，供 CSS 关掉面板过渡、浏览器面板跳过 renderer setBounds。
  useEffect(() => {
    let settleTimer: number | null = null
    const handleWindowResize = (): void => {
      document.body.classList.add('workbench-window-resizing')
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        document.body.classList.remove('workbench-window-resizing')
        settleTimer = null
        window.dispatchEvent(new CustomEvent('ncurator:workbench-window-resize-settled'))
      }, 120)
    }
    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      document.body.classList.remove('workbench-window-resizing')
    }
  }, [])

  // 向主进程注册右侧面板水平布局锚点：窗口 resize 时主进程同进程实时重算原生浏览器 view 的 bounds，
  // 避免 renderer→IPC→main 一拍延迟。仅在布局模型（比例/侧栏宽/挂载/折叠）变化时注册一次，缩放本身不发 IPC。
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const split = mainSplitRef.current
      if (!split) return
      const rect = split.getBoundingClientRect()
      const contentWidth = document.documentElement.clientWidth
      window.api.browserPanelSetFollow({
        splitLeft: Math.round(rect.left),
        rightMargin: Math.max(0, Math.round(contentWidth - rect.right)),
        ratio: contentPanelRatioRef.current,
        minWidth: WORKBENCH_CONTENT_PANEL_MIN_WIDTH,
        middleMin: WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH,
        maxRatio: WORKBENCH_CONTENT_PANEL_MAX_RATIO
      })
    })
    return () => window.cancelAnimationFrame(raf)
  }, [contentPanelRatio, contentPanelShellMounted, sidebarWidth, sidebarCollapsed])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const drag = sidebarDragStartRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const delta = event.clientX - drag.startX
      const nextWidth = clampWorkbenchSidebarWidth(drag.startWidth + delta)
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current)
      }
      sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
        setSidebarWidth(nextWidth)
        sidebarResizeFrameRef.current = null
      })
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const drag = sidebarDragStartRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current)
        sidebarResizeFrameRef.current = null
      }
      sidebarDragStartRef.current = null
      document.body.classList.remove('workbench-sidebar-resizing')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      if (sidebarResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const endContentPanelDrag = (): void => {
      if (contentPanelResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(contentPanelResizeFrameRef.current)
        contentPanelResizeFrameRef.current = null
      }
      contentPanelDragStartRef.current = null
      exitContentPanelPixelResize()
      setContentPanelResizeGuide(false)
      document.body.classList.remove('workbench-content-panel-resizing')
      document.body.classList.remove('workbench-content-panel-settling')
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const drag = contentPanelDragStartRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const available = mainSplitRef.current?.clientWidth ?? 0
      if (available <= 0) return
      // 分隔条在右侧面板左缘：向左拖加大宽度，向右拖减小。
      const nextWidth = drag.startWidth + (drag.startX - event.clientX)
      if (nextWidth < WORKBENCH_CONTENT_PANEL_COLLAPSE_WIDTH) {
        endContentPanelDrag()
        contentPanelRatioRef.current = contentPanelCommittedRatioRef.current
        applyContentPanelRatioCss(contentPanelCommittedRatioRef.current)
        collapseContentPanelRef.current()
        return
      }
      const maxByMiddle = Math.max(0, available - WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH)
      const maxByRatio = available * WORKBENCH_CONTENT_PANEL_MAX_RATIO
      const maxWidth = Math.max(
        WORKBENCH_CONTENT_PANEL_COLLAPSE_WIDTH,
        Math.min(maxByMiddle, maxByRatio)
      )
      const clamped = Math.round(
        Math.max(WORKBENCH_CONTENT_PANEL_COLLAPSE_WIDTH, Math.min(maxWidth, nextWidth))
      )
      if (contentPanelResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(contentPanelResizeFrameRef.current)
      }
      contentPanelResizeFrameRef.current = window.requestAnimationFrame(() => {
        applyContentPanelWidthPx(clamped)
        contentPanelRatioRef.current = clamped / available
        const splitLeft = mainSplitRef.current?.getBoundingClientRect().left ?? 0
        setContentPanelResizeGuide(true, splitLeft + available - clamped)
        contentPanelResizeFrameRef.current = null
      })
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const drag = contentPanelDragStartRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const available = mainSplitRef.current?.clientWidth ?? 0
      const width = contentPanelWidthPxRef.current

      if (contentPanelResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(contentPanelResizeFrameRef.current)
        contentPanelResizeFrameRef.current = null
      }
      contentPanelDragStartRef.current = null
      setContentPanelResizeGuide(false)
      document.body.classList.remove('workbench-content-panel-resizing')

      if (available > 0 && width > 0) {
        const nextRatio = clampWorkbenchContentPanelRatio(width / available)
        contentPanelRatioRef.current = nextRatio
        contentPanelCommittedRatioRef.current = nextRatio
        window.localStorage.setItem(WORKBENCH_CONTENT_PANEL_RATIO_STORAGE_KEY, String(nextRatio))

        // 通过 settling 保持 transition: none，消除像素切回比例时的 200ms 补间滞后
        document.body.classList.add('workbench-content-panel-settling')
        applyContentPanelRatioCss(nextRatio)
        setContentPanelRatio(nextRatio)
        exitContentPanelPixelResize()

        if (contentPanelDragSettlingFrameRef.current !== null) {
          window.cancelAnimationFrame(contentPanelDragSettlingFrameRef.current)
        }
        contentPanelDragSettlingFrameRef.current = window.requestAnimationFrame(() => {
          contentPanelDragSettlingFrameRef.current = null
          document.body.classList.remove('workbench-content-panel-settling')

          // 拖拽完成且布局稳定后，恢复原生浏览器渲染
          if (contentPanelRef.current.kind === 'browser' && !contentPanelCollapsedRef.current) {
            setBrowserPresentationEnabled(true)
            if (contentPanelDragRestoreTimerRef.current !== null) {
              window.clearTimeout(contentPanelDragRestoreTimerRef.current)
            }
            contentPanelDragRestoreTimerRef.current = window.setTimeout(() => {
              contentPanelDragRestoreTimerRef.current = null
              setBrowserTransitionImage(null)
            }, 60)
          }
        })
      } else {
        exitContentPanelPixelResize()
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      endContentPanelDrag()
      if (contentPanelDragSettlingFrameRef.current !== null) {
        window.cancelAnimationFrame(contentPanelDragSettlingFrameRef.current)
        contentPanelDragSettlingFrameRef.current = null
      }
      if (contentPanelDragRestoreTimerRef.current !== null) {
        window.clearTimeout(contentPanelDragRestoreTimerRef.current)
        contentPanelDragRestoreTimerRef.current = null
      }
      document.body.classList.remove('workbench-content-panel-settling')
    }
  }, [
    applyContentPanelRatioCss,
    applyContentPanelWidthPx,
    exitContentPanelPixelResize,
    setContentPanelResizeGuide
  ])

  useEffect(() => {
    scrollToBottom()
  }, [assistantTurns, currentMessages, loading, pendingApprovalBatch])

  useEffect(() => {
    let startTimer: number | null = null
    let finishTimer: number | null = null
    let imageTimer: number | null = null

    if (contentPanelCollapsed) {
      setBrowserPresentationEnabled(false)
      setContentPanelShellVisible(false)
      void window.api.browserPanelHide()
      finishTimer = window.setTimeout(() => {
        setContentPanelShellMounted(false)
        setBrowserTransitionImage(null)
      }, 220)
    } else {
      if (restoreContentPanelWithoutAnimationRef.current) {
        restoreContentPanelWithoutAnimationRef.current = false
        setContentPanelShellMounted(true)
        setContentPanelShellVisible(true)
        setBrowserPresentationEnabled(true)
        return
      }
      setBrowserPresentationEnabled(false)
      setContentPanelShellMounted(true)
      startTimer = window.setTimeout(() => {
        setContentPanelShellVisible(true)
        finishTimer = window.setTimeout(() => {
          setBrowserPresentationEnabled(true)
          imageTimer = window.setTimeout(() => setBrowserTransitionImage(null), 50)
        }, 220)
      })
    }

    return () => {
      if (startTimer !== null) window.clearTimeout(startTimer)
      if (finishTimer !== null) window.clearTimeout(finishTimer)
      if (imageTimer !== null) window.clearTimeout(imageTimer)
    }
  }, [contentPanelCollapsed, uiStateReadyKey])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    []
  )

  const requestDeletePartner = (event: React.MouseEvent, session: Partner): void => {
    event.stopPropagation()
    setDeleteConfirmPartner(session)
  }

  const togglePartnerPinned = (
    event: React.MouseEvent,
    session: PartnerListItem
  ): void => {
    event.stopPropagation()
    const nextPinned = !session.pinned
    const nextPinnedAt = nextPinned ? Date.now() : null
    setPartners((items) => {
      const next = items.map((item) =>
        item.id === session.id
          ? { ...item, pinned: nextPinned, pinned_at: nextPinnedAt }
          : item
      )
      return next.sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
        if (left.pinned && right.pinned) {
          return (right.pinned_at || 0) - (left.pinned_at || 0)
        }
        return 0
      })
    })
    void window.api.partnerSetPinned({ id: session.id, pinned: nextPinned }).then((response) => {
      if (!response.success) {
        emitErrorMessage(response.error || (nextPinned ? '置顶失败' : '取消置顶失败'))
        void loadPartners()
      }
    })
  }

  const confirmDeletePartner = async (): Promise<void> => {
    const session = deleteConfirmPartner
    if (!session || deletingPartnerIds.has(session.id)) return
    const id = session.id
    setDeletingPartnerIds((current) => new Set(current).add(id))
    try {
      const response = await window.api.partnerDelete(id)
      if (!response.success) {
        emitErrorMessage(response.error || '删除会话失败')
        return
      }
      const remainingPartners = partners.filter((item) => item.id !== id)
      const retryTimer = persistRetryTimersRef.current[id]
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      delete persistRetryTimersRef.current[id]
      delete persistRevisionsRef.current[id]
      delete composerDraftByPartnerIdRef.current[id]
      setTabWorkspaces((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setPartners(remainingPartners)
      if (currentPartnerIdRef.current === id) {
        const nextPartner = remainingPartners[0] || null
        if (nextPartner) {
          void openExistingPartner(nextPartner, { saveCurrentDraft: false })
        } else {
          currentPartnerIdRef.current = null
          setCurrentPartnerId(null)
          setCurrentMessages([])
          setAssistantTurns({})
          setAiRunId(null)
          setLoading(false)
          void window.api.workbenchUiStateSave({ activeViewKey: null })
        }
      }
      setDeleteConfirmPartner(null)
      void loadPartners()
    } catch (error) {
      console.error(error)
      emitErrorMessage('删除会话失败')
    } finally {
      setDeletingPartnerIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  const openFile = useCallback(
    async (file: WorkbenchFileRef, backTarget?: WorkbenchContentPanelState): Promise<void> => {
      const state: Extract<WorkbenchContentPanelState, { kind: 'file_preview' }> = {
        kind: 'file_preview',
        title: '文档查看',
        file,
        backTarget
      }
      openResourceTab({
        id: getFileTabId(file.path, detectRendererPlatform()),
        kind: 'file',
        title: file.fileName || getFileTabTitle(file.path),
        filePath: file.path,
        state
      })
    },
    [openResourceTab]
  )

  const openMarkdownReference = useCallback(
    async (reference: OpenableMarkdownReference): Promise<void> => {
      if (reference.resourceType === 'web') {
        const ownerId = currentPartnerIdRef.current
        if (!ownerId) return
        const listResponse = await window.api.browserTabList({ ownerId })
        const existing =
          listResponse.success && listResponse.tabs.length > 0
            ? findBrowserTabByUrl(listResponse.tabs, reference.path)
            : undefined

        if (existing) {
          openResourceTab({
            id: `browser:${existing.id}`,
            kind: 'browser',
            browserTabId: existing.id,
            title: existing.title || reference.label || existing.url || '浏览器',
            state: {
              kind: 'browser',
              title: existing.title || reference.label || existing.url || '浏览器',
              browserTabId: existing.id
            }
          })
          return
        }

        const createResponse = await window.api.browserTabCreate({ ownerId })
        if (!createResponse.success || !createResponse.state) {
          emitErrorMessage(createResponse.error || '无法打开内置浏览器')
          return
        }
        const browser = createResponse.state
        openResourceTab({
          id: `browser:${browser.id}`,
          kind: 'browser',
          browserTabId: browser.id,
          title: browser.title || reference.label || '浏览器',
          state: {
            kind: 'browser',
            title: browser.title || reference.label || '浏览器',
            browserTabId: browser.id
          }
        })
        void window.api.browserTabNavigate({
          tabId: browser.id,
          url: reference.path
        }).then((navigateResponse) => {
          if (!navigateResponse.success) {
            emitErrorMessage(navigateResponse.error || '打开链接失败')
          }
        })
        return
      }

      await openFile({
        path: reference.path,
        fileName:
          reference.path
            .replace(/\\/g, '/')
            .split('/')
            .filter(Boolean)
            .pop() || reference.label,
        origin: 'source'
      })
    },
    [emitErrorMessage, openFile, openResourceTab]
  )

  const handleOpenMarkdownReference = useCallback(
    (reference: OpenableMarkdownReference): void => {
      void openMarkdownReference(reference)
    },
    [openMarkdownReference]
  )

  const openFileChange = useCallback((changeId: string): void => {
    void window.api.aiFileChangeGet({ changeId }).then((response) => {
      if (response.record) {
        void loadFileChangesForPartnerRef.current(
          response.record.partnerId,
          response.record.runId,
          {
            preferredApplyId: changeId,
            forceOpenWorkspace: true
          }
        )
        return
      }
      void loadApplyRecordRef.current({
        applyId: changeId,
        openWorkspace: true
      })
    })
  }, [])

  const activateResourceTab = useCallback(
    (tabId: string): void => {
      const tab = tabWorkspace.tabs.find((item) => item.id === tabId)
      if (!tab) return
      const switchingAwayFromBrowser =
        contentPanel.kind === 'browser' &&
        (tab.kind !== 'browser' || tab.browserTabId !== contentPanel.browserTabId)
      if (switchingAwayFromBrowser) {
        void window.api.browserPanelHide()
      }
      updateCurrentTabWorkspace((current) => ({ ...current, activeTabId: tabId }))
      setContentPanel(tab.state)
      expandContentPanel()
      if (tab.kind === 'browser' && tab.browserTabId) {
        void window.api.browserTabActivate({ tabId: tab.browserTabId })
        if (!contentPanelCollapsedRef.current) {
          setBrowserPresentationEnabled(true)
        }
      }
      if (
        tab.state.kind === 'apply_workspace' &&
        tab.state.applyId &&
        !tab.state.applyId.startsWith('session:')
      ) {
        void loadApplyRecordRef.current({ applyId: tab.state.applyId })
      }
    },
    [contentPanel, expandContentPanel, tabWorkspace.tabs, updateCurrentTabWorkspace]
  )

  const closeResourceTab = useCallback(
    (tabId: string): void => {
      const closedIndex = tabWorkspace.tabs.findIndex((item) => item.id === tabId)
      if (closedIndex < 0) return
      const closedTab = tabWorkspace.tabs[closedIndex]
      if (closedTab?.kind === 'browser' && closedTab.browserTabId) {
        if (tabWorkspace.activeTabId === tabId) {
          void window.api.browserPanelHide()
        }
        void window.api.browserTabClose({ tabId: closedTab.browserTabId })
      }
      const tabs = tabWorkspace.tabs.filter((item) => item.id !== tabId)
      let nextActiveId = tabWorkspace.activeTabId
      let nextTab: WorkbenchResourceTab | undefined
      if (tabWorkspace.activeTabId === tabId) {
        nextTab = tabs[Math.min(closedIndex, tabs.length - 1)]
        nextActiveId = nextTab?.id || null
      }
      setTabWorkspaces((current) => ({
        ...current,
        [tabWorkspaceKey]: {
          ...(current[tabWorkspaceKey] || EMPTY_TAB_WORKSPACE),
          tabs,
          activeTabId: nextActiveId
        }
      }))
      if (tabWorkspace.activeTabId !== tabId) return
      if (!nextTab) {
        setContentPanel(createEmptyPanel())
        resetApplyWorkspaceState()
        return
      }
      setContentPanel(nextTab.state)
      if (
        nextTab.state.kind === 'apply_workspace' &&
        nextTab.state.applyId &&
        !nextTab.state.applyId.startsWith('session:')
      ) {
        void loadApplyRecordRef.current({ applyId: nextTab.state.applyId })
      }
    },
    [tabWorkspace, tabWorkspaceKey]
  )

  const addBrowserTab = useCallback((): void => {
    void openBrowserTab()
  }, [openBrowserTab])

  const handleBrowserStateChange = useCallback(
    (browser: BrowserTabState): void => {
      const resourceId = `browser:${browser.id}`
      const title = browser.title || (browser.url ? browser.url : '新标签页')
      setTabWorkspaces((current) => {
        const ownerKey = browser.ownerId || tabWorkspaceKey
        const workspace = current[ownerKey]
        if (!workspace) return current
        const tab = workspace.tabs.find((item) => item.id === resourceId)
        if (!tab) return current
        const currentBrowserState = tab.state.kind === 'browser' ? tab.state : null
        if (tab.title === title && currentBrowserState?.title === title) return current
        return {
          ...current,
          [ownerKey]: {
            ...workspace,
            tabs: workspace.tabs.map((tab) =>
              tab.id === resourceId
                ? {
                    ...tab,
                    title,
                    state: { kind: 'browser', title, browserTabId: browser.id }
                  }
                : tab
            )
          }
        }
      })
      setContentPanel((current) =>
        current.kind === 'browser' && current.browserTabId === browser.id && current.title !== title
          ? { ...current, title }
          : current
      )
    },
    [tabWorkspaceKey]
  )

  useEffect(
    () => window.api.onBrowserPanelStateChange(handleBrowserStateChange),
    [handleBrowserStateChange]
  )

  const addFileTab = useCallback((): void => {
    openResourceTab({
      id: 'file:launcher',
      kind: 'file',
      title: '打开文件',
      state: { kind: 'file_launcher', title: '打开文件' }
    })
  }, [openResourceTab])

  const openWorkspaceFile = useCallback(
    (filePath: string, fileName: string): void => {
      void openFile({ path: filePath, fileName, origin: 'preview' })
    },
    [openFile]
  )

  const openWorkspaceChange = useCallback(
    (changeId: string): void => {
      openFileChange(changeId)
    },
    [openFileChange]
  )

  useEffect(() => {
    const unsubscribe = window.api.onAiRunEvent((event) => {
      if (event.type === 'run_started') {
        activeRunPartnerIdsRef.current[event.runId] = event.partnerId
        setPartnerRunningState(event.partnerId, true)
      }
      const eventPartnerId = activeRunPartnerIdsRef.current[event.runId]

      if (
        event.type === 'run_completed' ||
        event.type === 'run_failed' ||
        event.type === 'run_cancelled'
      ) {
        if (eventPartnerId) {
          setPartnerRunningState(eventPartnerId, false)
          delete activeRunPartnerIdsRef.current[event.runId]
        }
        void loadPartners()
      }

      const messageId = activeRunMessageIdsRef.current[event.runId]
      if (!messageId) {
        if (event.type === 'run_started' && event.partnerId === currentPartnerIdRef.current) {
          const requestId = partnerSwitchRequestRef.current + 1
          partnerSwitchRequestRef.current = requestId
          void loadPartnerOpen(event.partnerId, requestId)
        }
        return
      }

      if (eventPartnerId !== currentPartnerIdRef.current) {
        if (event.type === 'browser_panel_opened' && eventPartnerId) {
          persistBackgroundBrowserTab(eventPartnerId, event.browserTabId)
        }
        return
      }

      if (event.type === 'run_started') {
        setAiRunId(event.runId)
      }

      updateTurnForRun(event.runId, (current) => reduceAssistantTurnByRunEvent(current, event))

      if (event.type === 'browser_panel_opened') {
        void openBrowserTab(event.browserTabId)
        return
      }

      if (event.type === 'file_artifact') {
        if (isRuntimeAssetPath(event.path)) return
        appendArtifactForMessage(assistantArtifactsRef.current, messageId, {
          kind: 'file',
          capability: event.capability,
          path: event.path,
          fileName: event.fileName,
          operation: event.operation,
          applyId: event.applyId
        })
        setCurrentMessages((previous) =>
          previous.map((item) =>
            item.id === messageId
              ? { ...item, artifacts: assistantArtifactsRef.current[messageId] || [] }
              : item
          )
        )
        return
      }

      if (event.type === 'run_warning') {
        if (!event.internal) {
          if (event.code === 'approval_denied') {
            setLoading(false)
            setPendingApprovalBatch(null)
            setApprovalCurrentIndex(0)
            setApprovalDraftDecisions({})
            setApprovalSubmitting(false)
          }
          message.warning(event.message || '当前运行出现告警')
        }
        return
      }

      if (event.type === 'approval_batch_required') {
        if (!event.internal) {
          setLoading(false)
          setApprovalSubmitting(false)
          setPendingApprovalBatch(event)
          setApprovalCurrentIndex(0)
          setApprovalDraftDecisions({})
        }
        return
      }

      if (event.type === 'approval_batch_decision') {
        if (event.internal) return
        setApprovalSubmitting(false)
        const allApproved = event.decisions.every((decision) => decision.action === 'approve')
        if (allApproved) {
          setLoading(true)
        } else {
          setPendingApprovalBatch(null)
          setApprovalCurrentIndex(0)
          setApprovalDraftDecisions({})
          setLoading(false)
        }
        return
      }

      if (event.type === 'answer_token') {
        setCurrentMessages((previous) =>
          previous.map((item) =>
            item.id === messageId
              ? { ...item, content: `${item.content || ''}${event.token}` }
              : item
          )
        )
        scrollToBottom()
        return
      }

      if (event.type === 'answer_completed') {
        setCurrentMessages((previous) =>
          previous.map((item) => (item.id === messageId ? { ...item, content: event.text } : item))
        )
        return
      }

      if (event.type === 'run_failed') {
        const errorText = formatRunFailureTitle(event)
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        setCurrentMessages((previous) =>
          previous.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  error: true,
                  content: item.content
                    ? `${item.content}\n\n失败：${errorText}`
                    : `失败：${errorText}`
                }
              : item
          )
        )
        if (eventPartnerId && eventPartnerId === currentPartnerIdRef.current) {
          void loadFileChangesForPartnerRef.current(eventPartnerId, event.runId)
        }
        emitErrorMessage(errorText)
        return
      }

      if (event.type === 'run_cancelled') {
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        setCurrentMessages((previous) =>
          previous.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  error: true,
                  content: item.content ? `${item.content}\n\n已取消` : '已取消'
                }
              : item
          )
        )
        if (eventPartnerId && eventPartnerId === currentPartnerIdRef.current) {
          void loadFileChangesForPartnerRef.current(eventPartnerId, event.runId)
        }
        message.info('已取消')
        return
      }

      if (event.type === 'run_completed') {
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        if (eventPartnerId && eventPartnerId === currentPartnerIdRef.current) {
          void loadFileChangesForPartnerRef.current(eventPartnerId, event.runId, {
            notifyNoEffectiveChange: true
          })
        }
        void refreshContextUsage(eventPartnerId || currentPartnerIdRef.current)
      }
    })
    return () => {
      unsubscribe()
    }
    // AI run listener is intentionally keyed by active run/session identity to avoid resubscribing on UI helper changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPartnerId, loadPartners, message, refreshContextUsage, setPartnerRunningState])

  const refreshBusyCancelNotice = useCallback(async (): Promise<void> => {
    if (!currentPartnerId) {
      setBusyCancelTask(null)
      return
    }
    try {
      const tasks = await window.api.scheduledTaskList()
      const matched = tasks.find(
        (task) => task.partnerId === currentPartnerId && task.busyCancelNoticeAt !== null
      )
      setBusyCancelTask(matched || null)
    } catch (error) {
      console.error('[WORKBENCH] busy cancel notice refresh failed:', error)
      setBusyCancelTask(null)
    }
  }, [currentPartnerId])

  useEffect(() => {
    void refreshBusyCancelNotice()
  }, [refreshBusyCancelNotice])

  useEffect(() => {
    return window.api.onPartnerListRefresh(() => {
      void loadPartners()
      void refreshBusyCancelNotice()
    })
  }, [loadPartners, refreshBusyCancelNotice])

  const ensureAttachmentTarget = useCallback(async (): Promise<{
    partnerId: string
    assetBucketId: string
  } | null> => {
    if (!currentPartnerId) {
      message.warning('请先选择伙伴后再添加附件')
      return null
    }

    let nextAssetBucketId = composerDraftValueRef.current.assetBucketId || assetBucketId
    if (!nextAssetBucketId) {
      nextAssetBucketId = crypto.randomUUID()
      setAssetBucketId(nextAssetBucketId)
      composerDraftValueRef.current = {
        ...composerDraftValueRef.current,
        assetBucketId: nextAssetBucketId
      }
    }

    return {
      partnerId: currentPartnerId,
      assetBucketId: nextAssetBucketId
    }
  }, [assetBucketId, currentPartnerId, message])

  const handleSend = async (): Promise<void> => {
    if (aiRunId) {
      await handleCancel()
      return
    }
    if (!input.trim() || loading || submitInFlightRef.current) return
    if (!currentPartnerId) {
      message.warning('请先选择伙伴后再发送消息')
      return
    }
    if (!modelSelection.mainModel) {
      message.warning('请先在输入框右下角选择主模型')
      return
    }

    const submitPartnerId = currentPartnerId
    const userQuery = input.trim()
    const submittedContentNodes = composerContentNodes
    const submittedReferences = selectedReferences
    const submittedAttachments = attachments
    const optimisticUserMessage: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      partner_id: submitPartnerId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now(),
      contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
      selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
      attachments: submittedAttachments.length > 0 ? submittedAttachments : undefined,
      error: false
    }
    const optimisticAssistantMessage: ChatMessage = {
      id: `local-assistant-${crypto.randomUUID()}`,
      partner_id: submitPartnerId,
      role: 'assistant',
      content: '',
      timestamp: optimisticUserMessage.timestamp + 1,
      error: false
    }
    const removeOptimisticMessages = (messages: ChatMessage[]): ChatMessage[] =>
      messages.filter(
        (messageItem) =>
          messageItem.id !== optimisticUserMessage.id &&
          messageItem.id !== optimisticAssistantMessage.id
      )
    const removeOptimisticAssistantTurn = (
      turns: Record<string, AssistantTurnViewModel>
    ): Record<string, AssistantTurnViewModel> => {
      const next = { ...turns }
      delete next[optimisticAssistantMessage.id]
      return next
    }
    const failOptimisticSubmit = (error: string): void => {
      const normalized = normalizeUserFacingError(error)
      setLoading(false)
      setCurrentMessages((previous) =>
        previous.map((item) =>
          item.id === optimisticAssistantMessage.id
            ? { ...item, error: true, content: `失败：${normalized}` }
            : item.id === optimisticUserMessage.id
              ? { ...item, error: true }
              : item
        )
      )
      setAssistantTurns((previous) => ({
        ...previous,
        [optimisticAssistantMessage.id]: {
          ...(previous[optimisticAssistantMessage.id] ||
            createThinkingAssistantTurn(optimisticAssistantMessage.id)),
          status: 'failed',
          error: normalized,
          processGroups: completeAssistantProcessGroups(
            previous[optimisticAssistantMessage.id]?.processGroups ||
              createThinkingAssistantTurn(optimisticAssistantMessage.id).processGroups,
            'failed'
          )
        }
      }))
      emitErrorMessage(normalized)
    }

    saveComposerDraftForPartner(submitPartnerId, createEmptyComposerDraft())
    applyComposerDraft(createEmptyComposerDraft(), `clear:${submitPartnerId}`)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setCancellingRun(false)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)
    lastSubmittedInputRef.current = userQuery
    setPartners((items) =>
      items.map((item) =>
        item.id === submitPartnerId
          ? {
              ...item,
              lastUserMessagePreview: clipPartnerListPreview(userQuery),
              lastActivityAt: optimisticUserMessage.timestamp
            }
          : item
      )
    )
    setCurrentMessages((previous) =>
      appendMessagesDedupe(previous, [optimisticUserMessage, optimisticAssistantMessage])
    )
    setAssistantTurns((previous) => ({
      ...previous,
      [optimisticAssistantMessage.id]: createThinkingAssistantTurn(optimisticAssistantMessage.id)
    }))

    submitInFlightRef.current = true
    try {
      const response = await window.api.chatSubmit({
        partnerId: submitPartnerId,
        input: userQuery,
        preference: composerAiPreference,
        executionPermission: composerExecutionPermission,
        contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
        selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
        attachments: submittedAttachments.length > 0 ? submittedAttachments : undefined,
        mainModel: modelSelection.mainModel
      })
      if (
        !response.success ||
        !response.run ||
        !response.userMessage ||
        !response.assistantMessage
      ) {
        failOptimisticSubmit(response.error || '启动失败')
        return
      }
      const run = response.run
      const assistantMessageId = response.assistantMessage.id
      activeRunMessageIdsRef.current[run.id] = assistantMessageId
      activeRunPartnerIdsRef.current[run.id] = run.partnerId
      assistantArtifactsRef.current[assistantMessageId] = []
      setCurrentMessages((previous) =>
        appendMessagesDedupe(removeOptimisticMessages(previous), [
          response.userMessage,
          response.assistantMessage
        ])
      )
      setAiRunId(run.id)
      setLoading(true)
      setPartnerRunningState(run.partnerId, true)
      setAssistantTurns((previous) => {
        const next = removeOptimisticAssistantTurn(previous)
        const optimisticTurn = previous[optimisticAssistantMessage.id]
        return {
          ...next,
          [assistantMessageId]: {
            ...(previous[assistantMessageId] ||
              optimisticTurn ||
              createThinkingAssistantTurn(assistantMessageId)),
            messageId: assistantMessageId,
            runId: run.id
          }
        }
      })
      void loadPartners()
    } catch (error) {
      console.error(error)
      failOptimisticSubmit(error instanceof Error ? error.message : '发送失败')
    } finally {
      submitInFlightRef.current = false
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (!aiRunId || cancellingRun) return
    setCancellingRun(true)
    try {
      const response = await window.api.aiRunCancel(aiRunId)
      if (!response.success) {
        setCancellingRun(false)
        emitErrorMessage(response.error || '取消失败')
      }
    } catch (error) {
      setCancellingRun(false)
      emitErrorMessage(error instanceof Error ? error.message : '取消失败')
    }
  }

  const handleClearPartnerContext = useCallback((): void => {
    if (!currentPartnerId) return
    const partnerName = currentPartner?.name || '伙伴'
    modal.confirm({
      title: '清空消息记录？',
      content: `将删除「${partnerName}」的全部对话消息，此操作无法恢复。伙伴本身会保留。`,
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const response = await window.api.partnerClearContext({ partnerId: currentPartnerId })
          if (!response.success) {
            emitErrorMessage(response.error || '清空消息记录失败')
            return
          }
          setCurrentMessages([])
          setHasMoreMessagesBefore(false)
          setActiveTimelineDayStart(null)
          void loadPartners()
        } catch (error) {
          emitErrorMessage(error instanceof Error ? error.message : '清空消息记录失败')
        }
      }
    })
  }, [
    currentPartner?.name,
    currentPartnerId,
    emitErrorMessage,
    loadPartners,
    modal
  ])

  const handleScheduledTaskBusyCancelAction = useCallback((): void => {
    if (!busyCancelTask) return
    const task = busyCancelTask
    modal.confirm({
      title: '立即执行定时任务？',
      content: `将按「${task.name}」的配置在专属伙伴执行。`,
      okText: '立即执行',
      cancelText: '取消',
      onOk: async () => {
        const response = await window.api.scheduledTaskRunNow({ id: task.id })
        if (!response.success) {
          message.warning(response.error || '立即执行失败')
          return
        }
        message.success('已开始执行')
        setBusyCancelTask(null)
        void loadPartners()
      }
    })
  }, [busyCancelTask, loadPartners, message, modal])

  const handleDismissScheduledTaskBusyCancel = useCallback(async (): Promise<void> => {
    if (!busyCancelTask) return
    try {
      const response = await window.api.scheduledTaskDismissBusyNotice({ id: busyCancelTask.id })
      if (!response.success) {
        message.warning(response.error || '关闭失败')
        return
      }
      setBusyCancelTask(null)
    } catch (error) {
      message.warning(error instanceof Error ? error.message : '关闭失败')
    }
  }, [busyCancelTask, message])

  const submitPartnerForm = useCallback(async (): Promise<void> => {
    const name = createPartnerName.trim()
    if (!name) {
      message.warning('请输入伙伴名称')
      return
    }
    if (createPartnerSubmitting) return
    setCreatePartnerSubmitting(true)
    try {
      if (editingPartnerId) {
        const response = await window.api.partnerUpdate({
          id: editingPartnerId,
          name,
          avatar_shape: createPartnerShape,
          avatar_color: createPartnerColor
        })
        if (!response.success || !response.partner) {
          emitErrorMessage(response.error || '保存伙伴失败')
          return
        }
        setCreatePartnerOpen(false)
        setEditingPartnerId(null)
        setCreatePartnerName('')
        void loadPartners()
        return
      }
      const response = await window.api.partnerCreate({
        name,
        avatar_shape: createPartnerShape,
        avatar_color: createPartnerColor
      })
      if (!response.success || !response.partner) {
        emitErrorMessage(response.error || '创建伙伴失败')
        return
      }
      setCreatePartnerOpen(false)
      setCreatePartnerName('')
      await openExistingPartner(response.partner, { saveCurrentDraft: false })
      void loadPartners()
    } catch (error) {
      emitErrorMessage(
        error instanceof Error
          ? error.message
          : editingPartnerId
            ? '保存伙伴失败'
            : '创建伙伴失败'
      )
    } finally {
      setCreatePartnerSubmitting(false)
    }
  }, [
    createPartnerColor,
    createPartnerName,
    createPartnerShape,
    createPartnerSubmitting,
    editingPartnerId,
    emitErrorMessage,
    loadPartners,
    message
  ])

  const openCreatePartnerModal = (): void => {
    setScheduledTasksActive(false)
    setEditingPartnerId(null)
    setCreatePartnerName('')
    setCreatePartnerShape('circle')
    setCreatePartnerColor('blue')
    setCreatePartnerOpen(true)
  }

  const openEditPartnerModal = (
    event: React.MouseEvent<HTMLButtonElement>,
    partner: PartnerListItem
  ): void => {
    event.stopPropagation()
    setEditingPartnerId(partner.id)
    setCreatePartnerName(partner.name)
    setCreatePartnerShape(partner.avatar_shape)
    setCreatePartnerColor(partner.avatar_color)
    setCreatePartnerOpen(true)
  }

  const setApprovalGuideMessage = (itemId: string, messageText: string): void => {
    setApprovalDraftDecisions((current) => ({
      ...current,
      [itemId]: {
        action: messageText.trim().length > 0 ? 'guide' : undefined,
        message: messageText
      }
    }))
  }

  const clearApprovalState = (): void => {
    setPendingApprovalBatch(null)
    setApprovalCurrentIndex(0)
    setApprovalDraftDecisions({})
  }

  const flushApprovalBatch = async (
    draftDecisions: Record<string, ApprovalDraftDecision>
  ): Promise<void> => {
    if (!pendingApprovalBatch || approvalSubmitting) return
    setApprovalSubmitting(true)
    try {
      const decisions = pendingApprovalBatch.items.map((item) => {
        const draft = draftDecisions[item.itemId]
        if (!draft?.action) {
          throw new Error('审批项尚未完成')
        }
        return {
          itemId: item.itemId,
          action: draft.action as ApprovalBatchDecisionAction,
          message: draft.action === 'guide' ? draft.message.trim() : undefined
        }
      })
      const response = await window.api.aiRunApprovalBatchDecide({
        runId: pendingApprovalBatch.runId,
        batchId: pendingApprovalBatch.batchId,
        decisions
      })
      if (!response.success) {
        setApprovalSubmitting(false)
        emitErrorMessage(response.error || '审核提交失败')
        return
      }
      const allApproved = decisions.every((decision) => decision.action === 'approve')
      clearApprovalState()
      if (allApproved) {
        setLoading(true)
      } else {
        setLoading(false)
      }
      setApprovalSubmitting(false)
    } catch (error) {
      setApprovalSubmitting(false)
      emitErrorMessage(error instanceof Error ? error.message : '审核提交失败')
    }
  }

  const handleApprovalDecision = async (input: {
    itemId: string
    action: ApprovalBatchDecisionAction
    message?: string
  }): Promise<void> => {
    if (!pendingApprovalBatch || approvalSubmitting) return
    const nextDraftDecisions: Record<string, ApprovalDraftDecision> = {
      ...approvalDraftDecisions,
      [input.itemId]: {
        action: input.action,
        message: input.action === 'guide' ? input.message || '' : ''
      }
    }

    const nextPendingIndex = pendingApprovalBatch.items.findIndex(
      (item, index) => index > approvalCurrentIndex && !nextDraftDecisions[item.itemId]?.action
    )
    const firstPendingIndex = pendingApprovalBatch.items.findIndex(
      (item) => !nextDraftDecisions[item.itemId]?.action
    )
    const hasRemainingUndecided = pendingApprovalBatch.items.some(
      (item) => !nextDraftDecisions[item.itemId]?.action
    )

    if (hasRemainingUndecided && (nextPendingIndex >= 0 || firstPendingIndex >= 0)) {
      setApprovalDraftDecisions(nextDraftDecisions)
      setApprovalCurrentIndex(nextPendingIndex >= 0 ? nextPendingIndex : firstPendingIndex)
      return
    }

    await flushApprovalBatch(nextDraftDecisions)
  }

  const handleApprovalBatchSubmit = async (): Promise<void> => {
    if (!currentApprovalItem || approvalSubmitting || approvalSubmitDisabled) return
    const messageText = approvalDraftDecisions[currentApprovalItem.itemId]?.message || ''
    await handleApprovalDecision({
      itemId: currentApprovalItem.itemId,
      action: 'guide',
      message: messageText.trim()
    })
  }

  const handleApplyRevert = async (): Promise<void> => {
    if (!activeApplyRecord || !currentPartnerId || applyReverting) return
    setApplyRevertConfirm({
      changeId: activeApplyRecord.id,
      stage: 'confirm',
      content: '文件将恢复到这次修改发生前的状态。'
    })
  }

  const handleApplyRevertConfirm = async (): Promise<void> => {
    if (!applyRevertConfirm || !currentPartnerId || applyReverting) return
    setApplyReverting(true)
    try {
      const response = await window.api.aiFileChangeRevert({
        changeId: applyRevertConfirm.changeId,
        force: applyRevertConfirm.stage === 'force'
      })
      if (response.requiresForce) {
        setApplyRevertConfirm({
          changeId: applyRevertConfirm.changeId,
          stage: 'force',
          content: response.warning || '文件在这次修改后又发生了变化。继续回退会覆盖之后的内容。'
        })
        return
      }
      if (!response.success) {
        emitErrorMessage(response.error || '回退失败')
        return
      }
      if (response.record) {
        setActiveApplyRecord(response.record)
        showApplyWorkspace(response.record)
      }
      setApplyRevertConfirm(null)
      emitSuccessMessage('已回退本次修改')
      const record = response.record || activeApplyRecord
      if (!record) return
      await loadFileChangesForPartner(record.partnerId, record.runId, {
        preferredApplyId: response.record?.id || applyRevertConfirm.changeId,
        autoOpen: true,
        forceOpenWorkspace: true,
        skipApplyRecordReload: true
      })
    } catch (error) {
      console.error(error)
      emitErrorMessage('回退失败')
    } finally {
      setApplyReverting(false)
    }
  }

  const handleCopyUserMessage = async (messageItem: ChatMessage): Promise<void> => {
    try {
      await navigator.clipboard.writeText(getUserMessagePlainText(messageItem))
      emitSuccessMessage('已复制')
    } catch (error) {
      console.error(error)
      emitErrorMessage('复制失败')
    }
  }

  const handleEditUserMessage = async (messageItem: ChatMessage): Promise<void> => {
    if (!currentPartnerId || aiRunId || messageItem.id !== latestUserMessageId) return
    const targetIndex = currentMessages.findIndex((item) => item.id === messageItem.id)
    if (targetIndex < 0) return
    const previousMessages = currentMessages
    const previousAssistantTurns = assistantTurns
    const previousAssistantArtifacts = { ...assistantArtifactsRef.current }
    const previousDraft = composerDraftValueRef.current
    const followingMessages = currentMessages.slice(targetIndex + 1)
    const followingAssistantIds = followingMessages
      .filter((item) => item.role === 'assistant')
      .map((item) => item.id)
    const draft: ComposerDraftValue = {
      input: messageItem.content,
      contentNodes: getUserMessageContentNodes(messageItem),
      selectedReferences:
        messageItem.selectedReferences ||
        getUserMessageContentNodes(messageItem)
          .filter(
            (node): node is Extract<ChatMessageContentNode, { kind: 'reference' }> =>
              node.kind === 'reference'
          )
          .map((node) => node.reference),
      attachments: messageItem.attachments || []
    }
    setCurrentMessages(currentMessages.slice(0, targetIndex))
    followingAssistantIds.forEach((assistantMessageId) => {
      delete assistantArtifactsRef.current[assistantMessageId]
    })
    setAssistantTurns((previous) => {
      const next = { ...previous }
      followingAssistantIds.forEach((assistantMessageId) => {
        delete next[assistantMessageId]
      })
      return next
    })
    saveComposerDraftForPartner(currentPartnerId, draft)
    applyComposerDraft(draft, `edit:${messageItem.id}`)
    shouldAutoScrollRef.current = true
    try {
      const response = await window.api.chatTurnRetractLatest({
        partnerId: currentPartnerId,
        userMessageId: messageItem.id
      })
      if (!response.success || !response.userMessage) {
        setCurrentMessages(previousMessages)
        setAssistantTurns(previousAssistantTurns)
        assistantArtifactsRef.current = previousAssistantArtifacts
        if (composerDraftValueRef.current.input === draft.input) {
          saveComposerDraftForPartner(currentPartnerId, previousDraft)
          applyComposerDraft(previousDraft, `edit-failed:${messageItem.id}`)
        }
        emitErrorMessage(response.error || '无法编辑这条消息')
        return
      }

      setCurrentMessages(response.messages)
      if (response.runId) {
        delete activeRunMessageIdsRef.current[response.runId]
      }
      if (response.assistantMessageId) {
        delete assistantArtifactsRef.current[response.assistantMessageId]
        setAssistantTurns((previous) => {
          const next = { ...previous }
          delete next[response.assistantMessageId!]
          return next
        })
      }
      void refreshContextUsage(currentPartnerId)
    } catch (error) {
      console.error(error)
      setCurrentMessages(previousMessages)
      setAssistantTurns(previousAssistantTurns)
      assistantArtifactsRef.current = previousAssistantArtifacts
      if (composerDraftValueRef.current.input === draft.input) {
        saveComposerDraftForPartner(currentPartnerId, previousDraft)
        applyComposerDraft(previousDraft, `edit-failed:${messageItem.id}`)
      }
      emitErrorMessage('编辑失败')
    }
  }

  const renderUserMessage = (messageItem: ChatMessage): React.ReactNode => {
    const contentNodes = getUserMessageContentNodes(messageItem)
    const canEdit = Boolean(currentPartnerId) && !aiRunId && messageItem.id === latestUserMessageId
    const showTime = userMessageTimeIds.has(messageItem.id)
    return (
      <div
        key={messageItem.id}
        data-message-id={messageItem.id}
        data-testid={`${workbenchSelectors.userMessagePrefix}-${messageItem.id}`}
      >
        {showTime ? (
          <div
            className="nc-message-time"
            data-testid={`${workbenchSelectors.userMessageTimePrefix}-${messageItem.id}`}
          >
            {formatUserMessageTimeLabel(messageItem.timestamp)}
          </div>
        ) : null}
        <div className="group/user-message flex justify-end">
          <div className="flex w-full min-w-0 flex-col items-end">
            {messageItem.attachments && messageItem.attachments.length > 0 ? (
              <div className="mb-2 w-full max-w-full pt-1">
                <div className="flex max-w-full flex-nowrap justify-end gap-2 overflow-x-auto overflow-y-hidden pb-1">
                  {messageItem.attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      className={`h-[54px] shrink-0 rounded-[8px] border border-[#E5E4E0] bg-white text-left shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition hover:border-[#D8D7D3] ${
                        attachment.kind === 'image'
                          ? 'w-[54px] overflow-hidden p-0'
                          : 'flex w-[220px] items-center gap-2 px-2 py-1.5'
                      }`}
                      title={attachment.name}
                      data-testid={`${workbenchSelectors.userMessageAttachmentPrefix}-${attachment.id}`}
                      onClick={() => {
                        if (attachment.kind === 'image') {
                          const src = messageAttachmentPreviewUrls[attachment.id]
                          if (src) setPreviewImage({ name: attachment.name, src })
                          return
                        }
                        void window.api.openPath(attachment.path)
                      }}
                    >
                      {attachment.kind === 'image' ? (
                        messageAttachmentPreviewUrls[attachment.id] ? (
                          <img
                            src={messageAttachmentPreviewUrls[attachment.id]}
                            alt={attachment.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-[#F4F4F2] text-[#787774]">
                            <HiPhoto className="h-5 w-5" />
                          </span>
                        )
                      ) : (
                        <>
                          <AttachmentFileIcon fileName={attachment.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium leading-5 text-[#37352F]">
                              {attachment.name}
                            </span>
                            <span className="block text-[12px] font-medium leading-4 text-[#787774]">
                              {getAttachmentTypeLabel(attachment.name)}
                            </span>
                          </span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex min-w-0 max-w-[66%] flex-col items-end">
              <div className="min-w-0 rounded-[22px] bg-[#F4F4F2] px-4 py-2.5 text-[14px] leading-6 text-[#37352F] [overflow-wrap:anywhere]">
                <div
                  className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                  data-testid={workbenchSelectors.userMessageReferences}
                >
                  {contentNodes.map((node, index) =>
                    node.kind === 'reference' ? (
                      <ReferenceInlineToken
                        key={
                          node.reference.kind === 'web'
                            ? `${index}:web:${node.reference.webSourceId}`
                            : `${index}:${node.reference.kind}:${node.reference.workspaceId}:${node.reference.nodeId}`
                        }
                        reference={node.reference}
                        className="mx-[1px]"
                      />
                    ) : (
                      <span key={`${index}:text`}>{node.text}</span>
                    )
                  )}
                </div>
              </div>
              <div
                className="mt-1 flex h-6 items-center justify-end gap-1.5 text-[12px] leading-none text-[#9B9A97] opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100"
                data-testid={`${workbenchSelectors.userMessageActionsPrefix}-${messageItem.id}`}
              >
                <Tooltip title="复制">
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[#9B9A97] transition hover:bg-[#F4F4F2] hover:text-[#37352F]"
                    aria-label="复制消息"
                    data-testid={`${workbenchSelectors.userMessageCopyButtonPrefix}-${messageItem.id}`}
                    onClick={() => void handleCopyUserMessage(messageItem)}
                  >
                    <HiOutlineClipboardDocument className="h-4 w-4" />
                  </button>
                </Tooltip>
                {canEdit ? (
                  <Tooltip title="编辑">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[#9B9A97] transition hover:bg-[#F4F4F2] hover:text-[#37352F]"
                      aria-label="编辑消息"
                      data-testid={`${workbenchSelectors.userMessageEditButtonPrefix}-${messageItem.id}`}
                      onClick={() => void handleEditUserMessage(messageItem)}
                    >
                      <HiOutlinePencilSquare className="h-4 w-4" />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderAssistantMessage = (messageItem: ChatMessage): React.ReactNode => {
    const turn = assistantTurns[messageItem.id]
    const hoverProps = {
      'data-message-id': messageItem.id,
      className: 'w-full'
    }
    if (!turn) {
      return (
        <div key={messageItem.id} {...hoverProps}>
          <div className="min-w-0 text-[15px] leading-7 text-[#37352F]">
            <MarkdownRenderer
              content={messageItem.content}
              linkAccess={messageItem.linkAccess}
              onOpenReference={handleOpenMarkdownReference}
            />
          </div>
        </div>
      )
    }

    return (
      <div key={messageItem.id} {...hoverProps}>
      <AssistantTurnCard
        messageId={messageItem.id}
        turn={turn}
        isStreaming={loading && Boolean(turn.runId && turn.runId === aiRunId)}
        onOpenApply={openFileChange}
        workspaces={workspaces}
        fallbackWorkspaceName={selectedWorkspaceName}
        onOpenReference={handleOpenMarkdownReference}
      />
      </div>
    )
  }

  const handleComposerDraftChange = useCallback(
    (draft: ComposerDraftValue) => {
      setInput(draft.input)
      setComposerContentNodes(draft.contentNodes)
      setSelectedReferences(draft.selectedReferences)
      setAttachments(draft.attachments || [])
      setAssetBucketId(draft.assetBucketId || null)
      saveComposerDraftForPartner(currentPartnerId, draft)
    },
    [currentPartnerId, saveComposerDraftForPartner]
  )

  const timelineMessageDayStarts = useMemo(
    () => collectMessageDayStarts(currentMessages.map((item) => item.timestamp)),
    [currentMessages]
  )

  const timelineNodes = useMemo(
    () =>
      buildTimelineNodes({
        messageDayStarts: timelineMessageDayStarts
      }),
    [timelineMessageDayStarts]
  )

  const activeTimelineNodeId = useMemo(
    () =>
      resolveActiveTimelineNodeId({
        nodes: timelineNodes,
        activeDayStart: activeTimelineDayStart
      }),
    [activeTimelineDayStart, timelineNodes]
  )

  useEffect(() => {
    if (activeTimelineDayStart != null || currentMessages.length === 0) return
    const latest = currentMessages[currentMessages.length - 1]
    if (latest) setActiveTimelineDayStart(startOfLocalDay(latest.timestamp))
  }, [activeTimelineDayStart, currentMessages])

  const sessionSwitching = Boolean(switchingPartnerId)
  // 判断是否为新会话（没有消息）
  const isNewSession = useMemo(
    () => !sessionSwitching && currentMessages.length === 0,
    [currentMessages, sessionSwitching]
  )
  const composerPlan = useMemo(() => {
    const activeTurn = aiRunId
      ? Object.values(assistantTurns).find((turn) => turn.runId === aiRunId)
      : undefined
    if (activeTurn?.status === 'completed') return []
    if (activeTurn?.plan.length) return activeTurn.plan

    for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
      const messageItem = currentMessages[index]
      if (messageItem.role !== 'assistant') continue
      const turn = assistantTurns[messageItem.id]
      if (!turn || turn.status === 'completed') return []
      return turn.plan
    }
    return []
  }, [aiRunId, assistantTurns, currentMessages])

  const renderPartnerRow = (partner: PartnerListItem): React.JSX.Element => {
    const PinIcon = partner.pinned ? BsPinAngleFill : BsPinAngle
    return (
      <div
        key={partner.id}
        role="button"
        tabIndex={0}
        data-testid={`${workbenchSelectors.partnerItemPrefix}-${partner.id}`}
        className={`nc-sidebar-item group relative ${
          currentPartnerId === partner.id ? 'nc-sidebar-item-active' : 'bg-transparent'
        } ${deletingPartnerIds.has(partner.id) ? 'pointer-events-none opacity-60' : ''} px-3 py-2`}
        onClick={() => selectPartner(partner)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            selectPartner(partner)
          }
        }}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <PartnerAvatar
            shape={partner.avatar_shape}
            color={partner.avatar_color}
            size={40}
            title={partner.name}
            animationSeed={partner.id}
            animated={partner.isRunning}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#37352F]">
                {partner.name}
              </div>
              <Tooltip title={partner.pinned ? '取消置顶' : '置顶'} placement="top">
                <button
                  type="button"
                  className={`${PARTNER_ROW_ACTION_CLASS} ${
                    partner.pinned ? 'flex' : 'hidden group-hover:flex'
                  }`}
                  data-testid={`${workbenchSelectors.partnerPinButtonPrefix}-${partner.id}`}
                  aria-label={partner.pinned ? '取消置顶' : '置顶'}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => togglePartnerPinned(event, partner)}
                >
                  <PinIcon className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip title="编辑" placement="top">
                <button
                  type="button"
                  className={`${PARTNER_ROW_ACTION_CLASS} hidden group-hover:flex`}
                  data-testid={`${workbenchSelectors.partnerEditButtonPrefix}-${partner.id}`}
                  aria-label="编辑伙伴"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => openEditPartnerModal(event, partner)}
                >
                  <HiOutlinePencilSquare className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip title="删除" placement="top">
                <button
                  type="button"
                  className={`${PARTNER_ROW_ACTION_CLASS} hidden group-hover:flex`}
                  data-testid={`${workbenchSelectors.partnerDeleteButtonPrefix}-${partner.id}`}
                  aria-label="删除伙伴"
                  disabled={deletingPartnerIds.has(partner.id)}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => requestDeletePartner(event, partner)}
                >
                  <HiTrash className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <div className="flex h-6 shrink-0 items-center gap-1 text-[11px] text-[#91918E] group-hover:hidden">
                {partner.isRunning ? (
                  <span className="nc-session-running-spinner" aria-label="任务运行中" />
                ) : partner.hasUnreadCompletion ? (
                  <span className="nc-session-unread-dot" aria-label="任务已完成，未查看" />
                ) : null}
                <span>{formatRelativeTime(partner.lastActivityAt)}</span>
              </div>
            </div>
            <div className="mt-0.5 truncate text-[12px] leading-4 text-[#8A8781]">
              {partner.lastUserMessagePreview || PARTNER_LIST_EMPTY_PREVIEW}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 获取平台信息
  const [platform, setPlatform] = useState<string>(() => detectRendererPlatform())
  useEffect(() => {
    setPlatform(detectRendererPlatform())
  }, [])

  return (
    <div
      className="nc-app-shell"
      data-testid={workbenchSelectors.page}
      data-workbench-mode="ai"
      onClick={acknowledgeCurrentPartnerCompletion}
    >
      <div
        className="nc-left-titlebar-chrome"
        style={{
          width: sidebarCollapsed ? WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH : sidebarWidth
        }}
      >
        {platform === 'darwin' ? (
          <div className="nc-left-titlebar-window-controls" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          className="nc-sidebar-titlebar-toggle nc-sidebar-titlebar-toggle-chrome workbench-no-drag"
          style={WORKBENCH_NO_DRAG_STYLE}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            setSidebarCollapsed((previous) => !previous)
          }}
          data-testid={workbenchSelectors.partnersToggle}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <SidebarPanelIcon
            className="h-4 w-4"
            variant={sidebarCollapsed ? 'expand' : 'collapse'}
          />
        </button>
        <div className="nc-left-titlebar-drag" aria-hidden="true" />
      </div>
      <aside
        className={`nc-sidebar ${platform === 'darwin' ? 'nc-sidebar-mac' : ''} ${
          sidebarCollapsed ? 'nc-sidebar-hidden' : ''
        }`}
        style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
        data-testid={workbenchSelectors.sidebar}
      >
        {platform === 'win32' ? (
          <div className="nc-sidebar-brand-row px-2" data-testid={workbenchSelectors.sidebarBrand}>
            <div className="flex h-9 w-full items-center gap-2 px-3">
              <img
                src={brandIcon}
                alt=""
                className="h-[22px] w-[22px] shrink-0"
                aria-hidden="true"
              />
              <span className="truncate text-[14px] font-semibold text-[#37352F]">馆长</span>
            </div>
          </div>
        ) : (
          <div className="nc-sidebar-window-spacer" aria-hidden="true" />
        )}

        <div className="px-2 py-3">
          <button
            type="button"
            className="nc-sidebar-nav-row nc-sidebar-new-chat"
            onClick={openCreatePartnerModal}
            data-testid={workbenchSelectors.newPartnerButton}
            aria-label="创建伙伴"
          >
            <HiPlus className="h-[18px] w-[18px] shrink-0 text-[#787774]" />
            <span>创建伙伴</span>
          </button>
          <button
            type="button"
            className={`nc-sidebar-nav-row ${scheduledTasksActive ? 'nc-sidebar-item-active' : ''}`}
            onClick={() => void openScheduledTasks()}
            data-testid={workbenchSelectors.scheduledTasksButton}
            aria-label={
              scheduledTaskEnabledCount > 0
                ? `定时任务，${scheduledTaskEnabledCount} 个已启用`
                : '定时任务'
            }
          >
            <HiOutlineClock
              className={`h-[18px] w-[18px] shrink-0 ${
                scheduledTaskEnabledCount > 0 ? 'text-[#2F5F8F]' : 'text-[#787774]'
              }`}
            />
            <span className="min-w-0 flex-1 truncate text-left">定时任务</span>
            <ScheduledTaskCountChip
              enabledCount={scheduledTaskEnabledCount}
              dataTestId={workbenchSelectors.scheduledTasksCountChip}
            />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-2 py-2"
          data-testid={workbenchSelectors.partnersList}
          data-hydrated={partnersListHydrated ? 'true' : 'false'}
        >
          {partners.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              {partners.map((partner) => renderPartnerRow(partner))}
            </div>
          )}
        </div>

        <div className="px-2 py-2">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => navigate('/settings/model')}
              className="nc-sidebar-nav-row flex-1"
              aria-label="设置"
            >
              <HiOutlineCog6Tooth className="h-[18px] w-[18px] shrink-0 text-[#787774]" />
              <span>设置</span>
            </button>
            <SidebarUpdateControl />
            <Tooltip title="查看使用帮助" placement="right">
              <button
                type="button"
                className="nc-manual-help-button"
                onClick={() => void window.api.openExternal(USER_MANUAL_URL)}
                aria-label="查看使用帮助"
                data-testid={workbenchSelectors.settingsHelpButton}
              >
                <HiOutlineQuestionMarkCircle className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>
        <div
          className="nc-sidebar-resizer workbench-no-drag"
          data-testid={workbenchSelectors.sidebarResizer}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            sidebarDragStartRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startWidth: sidebarWidth
            }
            document.body.classList.add('workbench-sidebar-resizing')
          }}
        />
      </aside>

      <div className="nc-main-pane min-w-0 flex-1" style={WORKBENCH_POSITIONED_PANE_STYLE}>
        {scheduledTasksActive ? (
          <ScheduledTasksView onEnabledCountChange={setScheduledTaskEnabledCount} />
        ) : (
          <>
            <div className="nc-main-split flex h-full min-h-0 overflow-hidden" ref={mainSplitRef}>
              <div className="relative flex min-w-0 flex-1 flex-col">
                {isNewSession ? (
              <div className="nc-main-empty-titlebar" aria-hidden="true">
                <div
                  className="nc-main-empty-titlebar-safe-zone"
                  style={{
                    width: sidebarCollapsed ? WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH : 0
                  }}
                />
                <div
                  className="nc-main-empty-titlebar-drag-region"
                  data-testid={workbenchSelectors.emptyDragRegion}
                />
                {contentPanelCollapsed && !contentPanelShellMounted ? (
                  <button
                    type="button"
                    className="nc-content-panel-titlebar-toggle workbench-no-drag"
                    style={WORKBENCH_NO_DRAG_REGION_STYLE}
                    title="展开右侧栏"
                    onClick={() => {
                      restoreCollapsedContentPanel()
                    }}
                    data-testid={workbenchSelectors.contentPanelToggle}
                    aria-label="展开右侧栏"
                  >
                    <SidebarPanelIcon className="h-4 w-4" variant="expand" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {!isNewSession ? (
              <div className="nc-topbar" data-testid={workbenchSelectors.topbar}>
                <div
                  className="nc-topbar-collapsed-safe-zone"
                  style={{
                    width: sidebarCollapsed ? WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH : 0
                  }}
                  aria-hidden="true"
                />
                <div className="nc-topbar-title-region min-w-0 flex-1 bg-white">
                  {currentPartner ? (
                    <div className="flex min-w-0 items-center gap-2 leading-none">
                      <div className="nc-topbar-title-text truncate text-sm font-semibold leading-none text-[#37352F]">
                        {currentPartner.name}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div
                  className="nc-topbar-drag-spacer"
                  style={WORKBENCH_DRAG_REGION_STYLE}
                  data-testid={workbenchSelectors.topbarDragRegion}
                  aria-hidden="true"
                />

                {contentPanelCollapsed && !contentPanelShellMounted ? (
                  <button
                    type="button"
                    className="nc-content-panel-titlebar-toggle workbench-no-drag"
                    style={WORKBENCH_NO_DRAG_REGION_STYLE}
                    title="展开右侧栏"
                    onClick={() => {
                      restoreCollapsedContentPanel()
                    }}
                    data-testid={workbenchSelectors.contentPanelToggle}
                    aria-label="展开右侧栏"
                  >
                    <SidebarPanelIcon className="h-4 w-4" variant="expand" />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div
              className="relative flex min-h-0 flex-1 overflow-hidden"
              data-testid={workbenchSelectors.attachmentDropTarget}
              onDragEnter={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                attachmentDragDepthRef.current += 1
                setIsAttachmentDropActive(true)
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDragLeave={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1)
                if (attachmentDragDepthRef.current === 0) setIsAttachmentDropActive(false)
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                attachmentDragDepthRef.current = 0
                setIsAttachmentDropActive(false)
                const files = getDroppedFiles(event.dataTransfer)
                if (files.length > 0) composerFileDropHandlerRef.current?.(files)
              }}
            >
              <div className="relative flex h-full min-h-0 min-w-0 flex-1">
                {!isNewSession ? (
                  <MessageTimeline
                    nodes={timelineNodes}
                    messageDayStarts={timelineMessageDayStarts}
                    activeNodeId={activeTimelineNodeId}
                    onSelectNode={handleTimelineNodeSelect}
                    onPickDay={jumpToTimelineDay}
                  />
                ) : null}
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                  <div
                    className={`nc-document-scroll ${isNewSession ? '!hidden' : ''}`}
                    ref={scrollRef}
                    onScroll={handleMessageScroll}
                  >
                    <div className="nc-document" data-testid={workbenchSelectors.messageList}>
                      {loadingOlderMessages ? (
                        <div className="py-3 text-center text-xs text-[#8A8781]">
                          正在加载更早消息
                        </div>
                      ) : null}
                      {currentMessages.map((messageItem) =>
                        messageItem.role === 'user'
                          ? renderUserMessage(messageItem)
                          : renderAssistantMessage(messageItem)
                      )}
                    </div>
                  </div>

                  <div
                    className={`nc-floating-composer-shell ${
                      isNewSession ? 'flex flex-1 items-center justify-center pb-[18vh]' : ''
                    }`}
                    data-testid={workbenchSelectors.composerShell}
                  >
                    <div className="mx-auto w-full max-w-[760px]">
                      {isNewSession && currentPartnerId ? (
                        <div className="mb-8 flex items-center justify-center text-center text-[28px] font-normal tracking-[-0.02em] text-[#37352F]">
                          <span>找俺干啥？</span>
                        </div>
                      ) : null}
                      {!currentPartnerId ? (
                        <div className="px-6 py-16 text-center text-[14px] leading-7 text-[#8A8781]">
                          {partners.length === 0
                            ? '还没有伙伴。从左侧创建一个开始对话。'
                            : '请选择一个伙伴开始对话。'}
                        </div>
                      ) : pendingApprovalBatch ? (
                        <div
                          className="min-w-0 overflow-hidden rounded-[12px] border border-[#E0DFDC] bg-[#FFFFFF] shadow-[0_8px_24px_rgba(15,15,15,0.08)]"
                          data-testid={chatSelectors.approvalBatchCard}
                        >
                          {pendingApprovalBatch && currentApprovalItem ? (
                            <div>
                              <div className="flex items-center justify-between gap-3 px-5 pt-4">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[15px] font-semibold text-[#37352F]">
                                      需要确认此操作
                                    </div>
                                    <div className="text-xs text-[#9B9A97]">
                                      审批 {approvalCurrentIndex + 1} /{' '}
                                      {pendingApprovalBatch.items.length}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<HiChevronLeft className="h-4 w-4" />}
                                    disabled={approvalCurrentIndex <= 0 || approvalSubmitting}
                                    onClick={() =>
                                      setApprovalCurrentIndex((current) => Math.max(0, current - 1))
                                    }
                                    data-testid={chatSelectors.approvalBatchPrevButton}
                                  />
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<HiChevronRight className="h-4 w-4" />}
                                    disabled={
                                      approvalCurrentIndex >=
                                        pendingApprovalBatch.items.length - 1 || approvalSubmitting
                                    }
                                    onClick={() =>
                                      setApprovalCurrentIndex((current) =>
                                        Math.min(pendingApprovalBatch.items.length - 1, current + 1)
                                      )
                                    }
                                    data-testid={chatSelectors.approvalBatchNextButton}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleCancel()}
                                    disabled={cancellingRun}
                                    className={`ml-1 inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-white transition ${
                                      cancellingRun
                                        ? 'bg-[#E0DFDC]'
                                        : 'bg-[#B3261E] hover:bg-[#8F3028]'
                                    }`}
                                    data-testid={workbenchSelectors.sendButton}
                                    aria-label="停止本次运行"
                                  >
                                    {cancellingRun ? (
                                      <Spin size="small" />
                                    ) : (
                                      <HiStop className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              <p className="mx-5 mt-3 text-[13px] leading-6 text-[#787774]">
                                {currentApprovalItem.commandExplanation}
                              </p>
                              <code className="mx-5 mt-3 block max-h-[min(34vh,320px)] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[#EEEEEC] bg-[#F4F4F2] px-3.5 py-3 font-mono text-[13px] leading-6 text-[#2F3437] [overflow-wrap:anywhere]">
                                {currentApprovalItem.command}
                              </code>
                              <div className="mx-2 mt-3 space-y-1">
                                <button
                                  type="button"
                                  className="grid min-h-11 w-full grid-cols-[1fr_auto] items-center rounded-[6px] px-3 text-left text-[13px] text-[#37352F] shadow-[inset_3px_0_0_#37352F,inset_0_0_0_1px_#EEEEEC] hover:bg-[#F4F4F2]"
                                  onClick={() =>
                                    void handleApprovalDecision({
                                      itemId: currentApprovalItem.itemId,
                                      action: 'approve'
                                    })
                                  }
                                  disabled={approvalSubmitting}
                                  data-testid={chatSelectors.approvalBatchApproveButton}
                                >
                                  <span>允许本次操作</span>
                                  <HiCheck className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  className="grid min-h-11 w-full grid-cols-[1fr_auto] items-center rounded-[6px] px-3 text-left text-[13px] text-[#787774] hover:bg-[#F4F4F2]"
                                  onClick={() =>
                                    void handleApprovalDecision({
                                      itemId: currentApprovalItem.itemId,
                                      action: 'reject'
                                    })
                                  }
                                  disabled={approvalSubmitting}
                                  data-testid={chatSelectors.approvalBatchDenyButton}
                                >
                                  <span>拒绝本次操作</span>
                                  <HiXMark className="h-4 w-4 text-[#B3261E]" />
                                </button>
                              </div>
                              <div className="mt-3 flex items-center gap-2 border-t border-[#EEEEEC] px-4 py-4">
                                <input
                                  className="min-w-0 flex-1 rounded-[6px] border border-[#EEEEEC] bg-[#FFFFFF] px-3 py-2 text-sm text-[#37352F] outline-none placeholder:text-[#9B9A97] focus:border-[#37352F] focus:ring-2 focus:ring-[#EFEFED]"
                                  placeholder="告诉 AI 接下来怎么做"
                                  value={
                                    approvalDraftDecisions[currentApprovalItem.itemId]?.message ||
                                    ''
                                  }
                                  onChange={(event) =>
                                    setApprovalGuideMessage(
                                      currentApprovalItem.itemId,
                                      event.target.value
                                    )
                                  }
                                  disabled={approvalSubmitting}
                                  data-testid={chatSelectors.approvalBatchGuideInput}
                                />
                                <Button
                                  type="primary"
                                  className="!flex !h-9 !items-center !gap-1 !rounded-full !border-[#37352F] !bg-[#37352F] !text-white hover:!bg-[#2F3437] disabled:!border-[#EEEEEC] disabled:!bg-[#F4F4F2] disabled:!text-[#9B9A97]"
                                  icon={<HiArrowUp className="h-4 w-4" />}
                                  onClick={() => void handleApprovalBatchSubmit()}
                                  loading={approvalSubmitting}
                                  disabled={approvalSubmitDisabled}
                                  data-testid={chatSelectors.approvalBatchSubmitButton}
                                >
                                  提交
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="relative">
                          {busyCancelTask || clearContextVisible ? (
                            <div className="mb-2 flex flex-col items-start gap-2">
                              {busyCancelTask ? (
                                <MessageActionCapsule
                                  icon={<HiOutlineClock className="h-3.5 w-3.5" />}
                                  label={`立即执行「${busyCancelTask.name}」`}
                                  tooltip={`「${busyCancelTask.name}」到点时伙伴正忙，本次已取消。点击可立即按该定时任务执行。`}
                                  onAction={handleScheduledTaskBusyCancelAction}
                                  dismissible
                                  onDismiss={() => void handleDismissScheduledTaskBusyCancel()}
                                  actionTestId={workbenchSelectors.scheduledTaskBusyCancelCapsule}
                                  dismissTestId={workbenchSelectors.scheduledTaskBusyCancelDismiss}
                                />
                              ) : null}
                              {clearContextVisible ? (
                                <MessageActionCapsule
                                  icon={<PiEraser className="h-3.5 w-3.5" />}
                                  label="清空消息记录"
                                  tooltip={`清空「${currentPartner?.name || '伙伴'}」的全部消息记录，无法恢复。`}
                                  onAction={handleClearPartnerContext}
                                  actionTestId={workbenchSelectors.clearContextButton}
                                />
                              ) : null}
                            </div>
                          ) : null}
                          <WorkbenchComposer
                          aiPreference={composerAiPreference}
                          onAiPreferenceChange={handleAiPreferenceChange}
                          executionPermission={composerExecutionPermission}
                          onExecutionPermissionChange={handleExecutionPermissionChange}
                          modelConfigs={modelConfigs}
                          modelListsByConfigId={modelListsByConfigId}
                          modelSelection={modelSelection}
                          onModelSelectionChange={handleModelSelectionChange}
                          onRefreshModelLists={refreshModelLists}
                          onDraftChange={handleComposerDraftChange}
                          onSubmit={() => void handleSend()}
                          onCancel={() => void handleCancel()}
                          onPreviewImage={setPreviewImage}
                          loading={loading}
                          cancelling={cancellingRun}
                          canSubmit={Boolean(
                            input.trim() && currentPartnerId && modelSelection.mainModel
                          )}
                          submitDisabledReason={composerSubmitDisabledReason}
                          showCancel={Boolean(aiRunId)}
                          draftValue={composerDraftValue}
                          draftKey={composerDraftKey}
                          contextUsage={contextUsage}
                          plan={composerPlan}
                          requestAttachmentTarget={ensureAttachmentTarget}
                          onFileDropHandlerReady={(handler) => {
                            composerFileDropHandlerRef.current = handler
                          }}
                        />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {isAttachmentDropActive ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/55 backdrop-blur-[1px]"
                  data-testid={workbenchSelectors.attachmentDropOverlay}
                >
                  <div className="border border-dashed border-[#7B96A8] bg-white/85 px-5 py-3 text-sm font-medium text-[#37586E] shadow-sm">
                    松开以添加文件
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {contentPanelShellMounted ? (
            <>
              <div
                ref={contentPanelResizeGuideRef}
                className="nc-content-panel-resize-guide"
                data-active="false"
                aria-hidden="true"
              />
              <div
                className="nc-content-panel-resizer workbench-no-drag"
                data-testid={workbenchSelectors.contentPanelResizer}
                onPointerEnter={() => {
                  if (
                    contentPanel.kind === 'browser' &&
                    contentPanel.browserTabId &&
                    browserPresentationEnabled &&
                    browserTransitionImage?.tabId !== contentPanel.browserTabId
                  ) {
                    void captureBrowserTransition(contentPanel.browserTabId)
                  }
                }}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)

                  if (contentPanelDragRestoreTimerRef.current !== null) {
                    window.clearTimeout(contentPanelDragRestoreTimerRef.current)
                    contentPanelDragRestoreTimerRef.current = null
                  }
                  if (contentPanelDragSettlingFrameRef.current !== null) {
                    window.cancelAnimationFrame(contentPanelDragSettlingFrameRef.current)
                    contentPanelDragSettlingFrameRef.current = null
                  }
                  document.body.classList.remove('workbench-content-panel-settling')

                  // 用当前真实渲染宽度作为起点，避免从 flex-basis 比例切到像素时跳变。
                  const startWidth = Math.round(
                    contentPanelShellRef.current?.getBoundingClientRect().width ??
                      contentPanelWidthPxRef.current
                  )
                  applyContentPanelWidthPx(startWidth)
                  enterContentPanelPixelResize()
                  contentPanelDragStartRef.current = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startWidth
                  }
                  const splitLeft = mainSplitRef.current?.getBoundingClientRect().left ?? 0
                  const available = mainSplitRef.current?.clientWidth ?? 0
                  setContentPanelResizeGuide(true, splitLeft + available - startWidth)
                  document.body.classList.add('workbench-content-panel-resizing')

                  if (contentPanel.kind === 'browser' && contentPanel.browserTabId) {
                    const tabId = contentPanel.browserTabId
                    const switchViewToSnapshot = (): void => {
                      setBrowserPresentationEnabled(false)
                      void window.api.browserPanelHide()
                    }
                    if (browserTransitionImage?.tabId === tabId) {
                      switchViewToSnapshot()
                    } else {
                      void captureBrowserTransition(tabId).then((dataUrl) => {
                        if (contentPanelDragStartRef.current && dataUrl) {
                          switchViewToSnapshot()
                        }
                      })
                    }
                  }
                }}
              />
              <div
                ref={contentPanelShellRef}
                className="nc-content-panel-shell"
                data-testid={workbenchSelectors.contentPanelShell}
                data-panel-visible={contentPanelShellVisible ? 'true' : 'false'}
              >
                <div
                  className="nc-content-panel-shell-inner"
                  style={{
                    transform: contentPanelShellVisible ? 'translateX(0)' : 'translateX(24px)',
                    opacity: contentPanelShellVisible ? 1 : 0
                  }}
                >
                  <WorkbenchContentPanel
                    state={contentPanel}
                    tabs={tabWorkspace.tabs}
                    activeTabId={tabWorkspace.activeTabId}
                    activeApplyRecord={activeApplyRecord}
                    applyLoading={applyLoading}
                    applyReverting={applyReverting}
                    workspaces={workspaces}
                    fallbackWorkspaceName={selectedWorkspaceName}
                    selectedWorkspace={selectedWorkspace || null}
                    fileChangeRecords={fileChangeRecords}
                    onRevertApply={() => void handleApplyRevert()}
                    onBackToPanelState={showContentPanel}
                    onOpenPath={openPathOrNotify}
                    onRevealPath={revealPathOrNotify}
                    onActivateTab={activateResourceTab}
                    onCloseTab={closeResourceTab}
                    onAddFileTab={addFileTab}
                    onAddBrowserTab={addBrowserTab}
                    onCollapse={collapseContentPanel}
                    onBrowserStateChange={handleBrowserStateChange}
                    onOpenWorkspaceFile={openWorkspaceFile}
                    onOpenWorkspaceChange={openWorkspaceChange}
                    isAiRunActive={Boolean(aiRunId)}
                    onSuccessMessage={emitSuccessMessage}
                    onInfoMessage={emitInfoMessage}
                    browserPresentationEnabled={browserPresentationEnabled}
                    browserTransitionImage={browserTransitionImage}
                  />
                </div>
              </div>
            </>
          ) : null}
            </div>
          </>
        )}
        <Modal
          open={Boolean(applyRevertConfirm)}
          title={applyRevertConfirm?.stage === 'force' ? '仍然回退这次修改？' : '回退这次修改？'}
          okText={applyRevertConfirm?.stage === 'force' ? '仍然回退' : '回退'}
          cancelText="取消"
          okButtonProps={{
            danger: applyRevertConfirm?.stage === 'force',
            'data-testid': workbenchSelectors.applyRevertConfirmButton
          }}
          cancelButtonProps={{
            'data-testid': workbenchSelectors.applyRevertCancelButton
          }}
          confirmLoading={applyReverting}
          onOk={() => void handleApplyRevertConfirm()}
          onCancel={() => setApplyRevertConfirm(null)}
          data-testid={workbenchSelectors.applyRevertConfirmModal}
        >
          <p>{applyRevertConfirm?.content}</p>
        </Modal>
        <ImageLightbox image={previewImage} onClose={() => setPreviewImage(null)} />
        <Modal
          open={Boolean(deleteConfirmPartner)}
          title="删除这个伙伴？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{
            danger: true,
            'data-testid': workbenchSelectors.partnerDeleteConfirmButton
          }}
          cancelButtonProps={{
            'data-testid': workbenchSelectors.partnerDeleteCancelButton
          }}
          confirmLoading={Boolean(
            deleteConfirmPartner && deletingPartnerIds.has(deleteConfirmPartner.id)
          )}
          onOk={() => void confirmDeletePartner()}
          onCancel={() => {
            if (deleteConfirmPartner && deletingPartnerIds.has(deleteConfirmPartner.id)) return
            setDeleteConfirmPartner(null)
          }}
          data-testid={workbenchSelectors.partnerDeleteConfirmModal}
        >
          <p className="text-sm leading-6 text-[#787774]">
            删除后会清掉这个伙伴的消息、记忆和恢复进度。这个操作不能撤回。
          </p>
          {deleteConfirmPartner ? (
            <div className="mt-3 rounded-[6px] border border-[#EEEEEC] bg-[#F7F7F5] px-3 py-2 text-sm font-medium text-[#37352F]">
              {deleteConfirmPartner.name || '未命名伙伴'}
            </div>
          ) : null}
        </Modal>
        <Modal
          open={createPartnerOpen}
          title={editingPartnerId ? '编辑伙伴' : '创建伙伴'}
          okText={editingPartnerId ? '保存' : '创建'}
          cancelText="取消"
          confirmLoading={createPartnerSubmitting}
          onOk={() => void submitPartnerForm()}
          onCancel={() => {
            if (createPartnerSubmitting) return
            setCreatePartnerOpen(false)
            setEditingPartnerId(null)
          }}
          data-testid={workbenchSelectors.createPartnerModal}
        >
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[13px] text-[#787774]">名称</div>
              <Input
                value={createPartnerName}
                onChange={(event) => setCreatePartnerName(event.target.value)}
                placeholder="给伙伴起个名字"
                maxLength={40}
                onPressEnter={() => void submitPartnerForm()}
                data-testid={workbenchSelectors.createPartnerNameInput}
              />
            </div>
            <div className="flex items-center gap-3">
              <PartnerAvatar
                shape={createPartnerShape}
                color={createPartnerColor}
                size={48}
                title={createPartnerName || '伙伴预览'}
                animationSeed={`preview-${createPartnerShape}-${createPartnerColor}`}
                animated
              />
              <div className="text-[13px] text-[#787774]">头像预览</div>
            </div>
            <div>
              <div className="mb-2 text-[13px] text-[#787774]">形状</div>
              <div className="flex flex-wrap gap-2">
                {PARTNER_AVATAR_SHAPES.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    className={`overflow-visible rounded-full p-0.5 ${
                      createPartnerShape === shape ? 'ring-2 ring-[#37352F]' : ''
                    }`}
                    onClick={() => setCreatePartnerShape(shape)}
                    aria-label={shape}
                  >
                    <PartnerAvatar
                      shape={shape}
                      color={createPartnerColor}
                      size={28}
                      animationSeed={`picker-${shape}`}
                      animated
                    />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] text-[#787774]">颜色</div>
              <div className="flex flex-wrap gap-2">
                {PARTNER_AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`h-6 w-6 rounded-full ${
                      createPartnerColor === color ? 'ring-2 ring-[#37352F] ring-offset-2' : ''
                    }`}
                    style={{ backgroundColor: PARTNER_AVATAR_COLOR_HEX[color] }}
                    onClick={() => setCreatePartnerColor(color)}
                    aria-label={color}
                  />
                ))}
              </div>
            </div>
          </div>
        </Modal>
        <FullAccessConfirmModal
          open={fullAccessConfirmOpen}
          onConfirm={handleConfirmFullAccess}
          onCancel={handleCancelFullAccess}
        />
      </div>
    </div>
  )
}

export default ChatPage
