import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, Modal, Spin, Tooltip } from 'antd'
import {
  HiArrowUp,
  HiCheck,
  HiChevronDown,
  HiChevronLeft,
  HiChevronRight,
  HiClock,
  HiFolder,
  HiOutlineClipboardDocument,
  HiOutlineClock,
  HiOutlineExclamationCircle,
  HiOutlineFolderPlus,
  HiOutlinePencilSquare,
  HiOutlineQuestionMarkCircle,
  HiPhoto,
  HiPlus,
  HiStop,
  HiTrash,
  HiXMark
} from 'react-icons/hi2'
import type {
  AiArtifactRef,
  AiFileChangeRecord,
  AiRunEvent,
  AiRunRecord,
  BrowserTabState,
  ChatAttachment,
  ChatMessage,
  ChatMessageContentNode,
  ChatSession,
  ChatSessionListItem,
  ChatSessionRunSnapshot,
  ChatSessionUiPanelState,
  ChatSessionUiStateV1,
  LLMConfig,
  LlmRemoteModel,
  SelectedReference,
  WorkbenchModelSelection,
  WorkspaceSource,
  WorkspaceRuntimeBinding
} from '../../../shared/types'
import { NO_EFFECTIVE_FILE_CHANGE_MESSAGE, USER_MANUAL_URL } from '../../../shared/constants'
import { resolveLlmProvider } from '../../../shared/llmProvider'
import { getPresetModel, getPresetProvider } from '../../../shared/llmPresets'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useNavigate } from 'react-router-dom'
import { normalizeUserFacingError } from '../utils/userFacingError'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import AssistantTurnCard from '../components/workbench/AssistantTurnCard'
import WorkbenchComposer from '../components/workbench/WorkbenchComposer'
import WorkbenchContentPanel from '../components/workbench/WorkbenchContentPanel'
import ScheduledTasksView from '../components/scheduledTasks/ScheduledTasksView'
import ImageLightbox from '../components/workbench/ImageLightbox'
import AttachmentFileIcon from '../components/workbench/composer/AttachmentFileIcon'
import ReferenceInlineToken from '../components/workbench/composer/ReferenceInlineToken'
import type { ImageLightboxImage } from '../components/workbench/ImageLightbox'
import type { ComposerDraftValue } from '../components/workbench/composer/types'
import {
  WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH,
  WORKBENCH_LEGACY_PREFERENCE_STORAGE_KEYS,
  WORKBENCH_SIDEBAR_DEFAULT_WIDTH,
  WORKBENCH_SIDEBAR_MAX_WIDTH,
  WORKBENCH_SIDEBAR_MIN_WIDTH,
  WORKBENCH_SIDEBAR_STORAGE_KEY,
  WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY
} from '../components/workbench/constants'
import type {
  AssistantTurnViewModel,
  WorkbenchContextUsage,
  SearchWorkbenchTurn,
  WorkbenchContentPanelState,
  WorkbenchFileRef,
  WorkbenchResourceTab,
  WorkbenchTabWorkspaceState,
  WorkbenchAiPreference,
  WorkbenchExecutionPermission,
  WorkbenchMode
} from '../components/workbench/types'
import type {
  ParsedNcuratorRefKind,
  ParsedNcuratorRefResourceType
} from '../components/markdownReference'
import {
  completeAssistantProcessGroups,
  createAssistantThinkingGroup,
  createSearchProcessGroup,
  dedupeFileRefs,
  extractReadableFilesFromToolOutput,
  formatRelativeTime,
  getAttachmentTypeLabel,
  getSearchResultFileRef,
  reduceAssistantProcessGroups,
  reduceAssistantProcessThoughts
} from '../components/workbench/utils'
import { projectProcessGroups } from '../components/workbench/messageLogProjection'
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
import {
  collectReferenceDocumentIds,
  getReferenceKey,
  pruneReferencesByWorkspace
} from '../utils/reference'
import { useWorkbenchMode } from '../contexts/WorkbenchModeContext'
import SidebarUpdateControl from '../components/update/SidebarUpdateControl'

type ApprovalBatchRequiredEvent = Extract<AiRunEvent, { type: 'approval_batch_required' }>
type ApprovalBatchDecisionAction = 'approve' | 'reject' | 'guide'
const COLLAPSED_WORKSPACE_SESSION_LIMIT = 5
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

const padTimePart = (value: number): string => String(value).padStart(2, '0')

const formatUserMessageTime = (timestamp: number, now = Date.now()): string => {
  const date = new Date(timestamp)
  const time = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
  const ageMs = now - timestamp
  if (ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000) return time

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const messageDay = new Date(timestamp)
  messageDay.setHours(0, 0, 0, 0)
  const dayGap = Math.round((today.getTime() - messageDay.getTime()) / (24 * 60 * 60 * 1000))
  if (dayGap === 1) return `昨天 ${time}`
  if (dayGap > 1 && dayGap < 7) {
    return `${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()]} ${time}`
  }
  return `${date.getFullYear()}/${padTimePart(date.getMonth() + 1)}/${padTimePart(date.getDate())} ${time}`
}

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
  processThoughts: [],
  processGroups: [],
  finalAnswerMarkdown: '',
  streamingMarkdown: '',
  streamingRole: 'answer',
  plan: [],
  artifacts: [],
  applyTargets: [],
  blockers: []
})

const createThinkingAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  ...createAssistantTurn(messageId),
  processGroups: [createAssistantThinkingGroup(messageId)]
})

const createSearchAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  messageId,
  status: 'running',
  runFinished: false,
  processThoughts: [],
  processGroups: [createSearchProcessGroup(messageId)],
  finalAnswerMarkdown: '',
  streamingMarkdown: '',
  streamingRole: 'answer',
  plan: [],
  artifacts: [],
  applyTargets: [],
  blockers: []
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

const buildAssistantTurnFromMessage = (message: ChatMessage): AssistantTurnViewModel | null => {
  if (message.role !== 'assistant') return null
  const artifacts = message.artifacts || []
  return {
    messageId: message.id,
    status: message.error ? 'failed' : 'completed',
    runFinished: true,
    processThoughts: [],
    processGroups: [],
    finalAnswerMarkdown: message.content,
    streamingMarkdown: '',
    streamingRole: 'answer',
    plan: [],
    artifacts: artifacts.map((artifact) => ({
      path: artifact.path,
      fileName: artifact.fileName,
      origin: 'artifact',
      applyId: artifact.applyId,
      operation: artifact.operation,
      format:
        artifact.capability === 'docx' ? 'docx' : artifact.capability === 'ppt' ? 'pptx' : undefined
    })),
    applyTargets: artifacts
      .map(artifactToApplyTarget)
      .filter((target): target is AssistantTurnViewModel['applyTargets'][number] =>
        Boolean(target)
      ),
    blockers: []
  }
}

const getRunMessageContent = (run: AiRunRecord): string =>
  run.finalAnswer || run.partialAnswer || ''

const formatRunFailureMessage = (event: Extract<AiRunEvent, { type: 'run_failed' }>): string => {
  if (event.source !== 'provider') return event.message || '运行失败，请重试。'
  const metadata = [
    event.httpStatus ? `HTTP ${event.httpStatus}` : '',
    event.providerCode || ''
  ].filter(Boolean)
  return metadata.length > 0
    ? `${metadata.join(' · ')}\n${event.message || '模型服务请求失败。'}`
    : event.message || '模型服务请求失败。'
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

  if (event.type === 'runtime_issue') {
    next = { ...next, status: 'failed', error: event.message }
  }

  if (event.type === 'approval_batch_required') {
    next = {
      ...next,
      blockers: [
        {
          kind: 'approval',
          title: '等待批量审核',
          description: `共有 ${event.items.length} 条命令待审核`
        }
      ]
    }
  }

  if (event.type === 'approval_batch_decision') {
    next = { ...next, blockers: [] }
  }

  if (event.type === 'assistant_brain_stream_started') {
    next = {
      ...next,
      streamingRoundId: event.roundId,
      streamingMarkdown: '',
      streamingRole: 'answer'
    }
  }

  if (
    event.type === 'assistant_brain_stream_delta' &&
    next.streamingRoundId === event.roundId
  ) {
    next = { ...next, streamingMarkdown: `${next.streamingMarkdown}${event.text}` }
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
    next = { ...next, streamingRole: 'thought' }
  }

  if (
    event.type === 'assistant_brain_stream_completed' &&
    next.streamingRoundId === event.roundId
  ) {
    next =
      event.role === 'answer'
        ? {
            ...next,
            finalAnswerMarkdown: event.text,
            streamingMarkdown: '',
            streamingRole: 'answer'
          }
        : { ...next, streamingMarkdown: event.text, streamingRole: 'thought' }
  }

  if (event.type === 'assistant_process_thought') {
    next = { ...next, streamingMarkdown: '', streamingRole: 'answer' }
  }

  if (event.type === 'assistant_plan_updated') {
    next = { ...next, plan: event.plan }
  }

  if (event.type === 'answer_token') {
    next = {
      ...next,
      finalAnswerMarkdown: `${next.finalAnswerMarkdown}${event.token}`,
      processGroups: completeAssistantProcessGroups(next.processGroups)
    }
  }

  if (event.type === 'answer_completed') {
    next = {
      ...next,
      finalAnswerMarkdown: event.text,
      streamingMarkdown: '',
      processGroups: completeAssistantProcessGroups(next.processGroups)
    }
  }

  if (event.type === 'run_failed') {
    next = {
      ...next,
      status: 'failed',
      runFinished: true,
      error: formatRunFailureMessage(event)
    }
  }

  if (event.type === 'run_cancelled') {
    next = { ...next, status: 'failed', runFinished: true, error: '已取消' }
  }

  if (event.type === 'run_completed') {
    next = {
      ...next,
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
    runFinished:
      run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled',
    processGroups:
      run.status === 'completed' || Boolean(getRunMessageContent(run))
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
    blockers: run.pendingApproval
      ? [
          {
            kind: 'approval',
            title: '等待批量审核',
            description: `共有 ${run.pendingApproval.items.length} 条命令待审核`
            }
          ]
        : turn.blockers,
    error: run.error || turn.error
  }
}

const buildAssistantTurnFromRunSnapshot = (
  snapshot: ChatSessionRunSnapshot
): AssistantTurnViewModel => {
  const projected = projectProcessGroups({
    runId: snapshot.run.id,
    entries: (snapshot.messageLogRecords || []).map((record) => record.entry)
  })
  const base: AssistantTurnViewModel = {
    ...createAssistantTurn(snapshot.run.assistantMessageId),
    runId: snapshot.run.id,
    processThoughts: projected.processThoughts,
    processGroups: projected.processGroups
  }
  for (const record of snapshot.messageLogRecords || []) {
    const entry = record.entry
    if (entry.kind === 'annotation' && entry.eventType === 'plan_updated') {
      base.plan = entry.payload.plan
    } else if (entry.kind === 'annotation' && entry.eventType === 'finalizing_started') {
      base.plan = []
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

const createWorkspaceBinding = (
  workspace: WorkspaceSource | null
): WorkspaceRuntimeBinding | undefined =>
  hasWorkspaceRootPath(workspace)
    ? {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        rootPath: workspace.root_path
      }
    : undefined

const hasWorkspaceRootPath = (
  workspace: WorkspaceSource | null
): workspace is WorkspaceSource & { root_path: string } =>
  typeof workspace?.root_path === 'string' && workspace.root_path.trim().length > 0

const getWorkspaceRequirementHint = (workspace: WorkspaceSource | null): string =>
  workspace ? '当前工作区未设置文件目录，请前往 设置 > 工作空间 设置工作目录后' : '请先选择工作区'

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
): ChatSessionUiStateV1['composer']['draft'] => ({
  input: draft.input,
  contentNodes: draft.contentNodes,
  selectedReferences: draft.selectedReferences,
  attachments: draft.attachments,
  assetBucketId: draft.assetBucketId || null
})

const isChatModel = (modelId: string): boolean =>
  !/(image|audio|video|tts|asr|realtime|embedding|rerank|ocr|transcri|whisper|search|speech)/u.test(
    modelId.toLowerCase()
  )

const pickChatModel = (models: readonly LlmRemoteModel[]): LlmRemoteModel | undefined =>
  models.find((item) => isChatModel(item.id))

const isPresetModelSelectable = (config: LLMConfig, modelName: string): boolean => {
  const providerId = resolveLlmProvider(config.base_url).providerId
  const preset = getPresetProvider(providerId)
  return Boolean(preset && getPresetModel(preset, modelName))
}

const resolveSelectedModel = (
  configs: LLMConfig[],
  modelListsByConfigId: Record<string, LlmRemoteModel[]>,
  selected: WorkbenchModelSelection['mainModel']
): WorkbenchModelSelection['mainModel'] => {
  if (!selected?.configId || !selected.modelName) return null
  const config = configs.find((item) => item.id === selected.configId)
  if (!config) return null
  const remote = modelListsByConfigId[config.id]?.find((item) => item.id === selected.modelName)
  if (remote) return { ...selected }
  return isPresetModelSelectable(config, selected.modelName) ? { ...selected } : null
}

const pickFallbackModel = (configs: LLMConfig[]): WorkbenchModelSelection['mainModel'] | null => {
  for (const config of configs) {
    const providerId = resolveLlmProvider(config.base_url).providerId
    const preset = getPresetProvider(providerId)
    if (preset && preset.models.length > 0) {
      return { configId: config.id, modelName: preset.models[0].id }
    }
  }
  return null
}

const createDefaultSessionUiState = (
  modelSelection: WorkbenchModelSelection = { mainModel: null },
  workspaceId: string | null = null
): ChatSessionUiStateV1 => ({
  version: 1,
  composer: {
    mode: 'ai',
    aiPreference: 'default',
    executionPermission: 'review',
    modelSelection,
    workspaceId,
    draft: toPersistedComposerDraft(createEmptyComposerDraft())
  },
  panel: {
    tabs: [],
    activeTabId: null,
    collapsed: true,
    fallbackState: createEmptyPanel() as ChatSessionUiPanelState
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
  const { message } = AntdApp.useApp()
  const navigate = useNavigate()
  const openWorkspaceSettings = useCallback(() => {
    navigate('/settings/workspace')
  }, [navigate])
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null)
  const [hasMoreMessagesBefore, setHasMoreMessagesBefore] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [deleteConfirmSession, setDeleteConfirmSession] = useState<ChatSession | null>(null)
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set())
  const { mode: composerMode, setMode: setComposerMode } = useWorkbenchMode()
  const [composerAiPreference, setComposerAiPreference] = useState<WorkbenchAiPreference>('default')
  const [composerExecutionPermission, setComposerExecutionPermission] =
    useState<WorkbenchExecutionPermission>('review')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiRunId, setAiRunId] = useState<string | null>(null)
  const [cancellingRun, setCancellingRun] = useState(false)
  const [composerContentNodes, setComposerContentNodes] = useState<ChatMessageContentNode[]>([])
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [assetBucketId, setAssetBucketId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSource[]>([])
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [workspaceDocumentIds, setWorkspaceDocumentIds] = useState<string[]>([])
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
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Set<string>>(() => new Set())
  const [expandedWorkspaceSessionIds, setExpandedWorkspaceSessionIds] = useState<Set<string>>(
    () => new Set()
  )
  const [contentPanelCollapsed, setContentPanelCollapsed] = useState(true)
  const [contentPanelShellMounted, setContentPanelShellMounted] = useState(false)
  const [contentPanelShellVisible, setContentPanelShellVisible] = useState(false)
  const [scheduledTasksActive, setScheduledTasksActive] = useState(false)
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
  const activeRunSessionIdsRef = useRef<Record<string, string>>({})
  const assistantArtifactsRef = useRef<Record<string, AiArtifactRef[]>>({})
  const currentSessionIdRef = useRef<string | null>(null)
  const submitInFlightRef = useRef(false)
  const lastSubmittedInputRef = useRef('')
  const sessionSwitchRequestRef = useRef(0)
  const sessionListHydratedRef = useRef(false)
  const composerDraftBySessionIdRef = useRef<Record<string, ComposerDraftValue>>({})
  const composerDraftVersionRef = useRef(0)
  const loadApplyRecordRef = useRef<
    (input: {
      applyId: string
      detail?: AiFileChangeRecord | null
      openWorkspace?: boolean
    }) => Promise<void>
  >(async () => {})
  const loadFileChangesForSessionRef = useRef<
    (
      sessionId: string,
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const messageAttachmentPreviewUrlsRef = useRef<Record<string, string>>({})
  const notifiedNoEffectiveChangeIdsRef = useRef<Set<string>>(new Set())
  const composerModeRef = useRef<WorkbenchMode>(composerMode)
  const composerAiPreferenceRef = useRef<WorkbenchAiPreference>(composerAiPreference)
  const composerExecutionPermissionRef = useRef<WorkbenchExecutionPermission>(
    composerExecutionPermission
  )
  const composerFileDropHandlerRef = useRef<((files: File[]) => void) | null>(null)
  const attachmentDragDepthRef = useRef(0)
  const [isAttachmentDropActive, setIsAttachmentDropActive] = useState(false)
  const modelSelectionRef = useRef<WorkbenchModelSelection>(modelSelection)
  const selectedWorkspaceIdRef = useRef<string | null>(selectedWorkspaceId)
  const contentPanelRef = useRef<WorkbenchContentPanelState>(contentPanel)
  const tabWorkspacesRef = useRef<Record<string, WorkbenchTabWorkspaceState>>(tabWorkspaces)
  const contentPanelCollapsedRef = useRef(contentPanelCollapsed)
  const panelFallbackByKeyRef = useRef<Record<string, WorkbenchContentPanelState>>({})
  const uiStateReadyKeyRef = useRef<string | null>(null)
  const [uiStateReadyKey, setUiStateReadyKey] = useState<string | null>(null)
  const persistedDraftStateRef = useRef<ChatSessionUiStateV1 | null>(null)
  const persistTimersRef = useRef<Record<string, number>>({})
  const persistQueuesRef = useRef<Record<string, Promise<void>>>({})
  const persistRevisionsRef = useRef<Record<string, number>>({})
  const persistRetryTimersRef = useRef<Record<string, number>>({})
  const persistFailureNotifiedRef = useRef<Set<string>>(new Set())
  const missingAttachmentNotifiedRef = useRef<Set<string>>(new Set())
  const uiStateInteractionVersionRef = useRef(0)

  const tabWorkspaceKey = currentSessionId || '__draft__'
  const tabWorkspace = tabWorkspaces[tabWorkspaceKey] || EMPTY_TAB_WORKSPACE

  const buildUiStateForKey = useCallback((key: string): ChatSessionUiStateV1 => {
    const workspace = tabWorkspacesRef.current[key] || EMPTY_TAB_WORKSPACE
    const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId)
    const fallback =
      panelFallbackByKeyRef.current[key] ||
      (!activeTab ? contentPanelRef.current : createEmptyPanel())
    return {
      version: 1,
      composer: {
        mode: composerModeRef.current,
        aiPreference: composerAiPreferenceRef.current,
        executionPermission: composerExecutionPermissionRef.current,
        modelSelection: modelSelectionRef.current,
        workspaceId: selectedWorkspaceIdRef.current,
        draft: toPersistedComposerDraft(composerDraftValueRef.current)
      },
      panel: {
        tabs: workspace.tabs,
        activeTabId: workspace.activeTabId,
        collapsed: contentPanelCollapsedRef.current,
        fallbackState: fallback as ChatSessionUiPanelState
      }
    }
  }, [])

  const persistUiStateForKey = useCallback(
    (key: string, state: ChatSessionUiStateV1): Promise<void> => {
      if (key === '__draft__') persistedDraftStateRef.current = state
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
                const response =
                  key === '__draft__'
                    ? await window.api.workbenchUiStateSave({
                        activeViewKey: currentSessionIdRef.current || '__draft__',
                        draftState: state
                      })
                    : await window.api.chatSessionUiStateSave({ sessionId: key, state })
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
    const key = currentSessionIdRef.current || '__draft__'
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
      const key = currentSessionIdRef.current || '__draft__'
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
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    composerDraftValueRef.current = composerDraftValue
  }, [composerDraftValue])

  useEffect(() => {
    composerModeRef.current = composerMode
    composerAiPreferenceRef.current = composerAiPreference
    composerExecutionPermissionRef.current = composerExecutionPermission
    modelSelectionRef.current = modelSelection
    selectedWorkspaceIdRef.current = selectedWorkspaceId
    contentPanelRef.current = contentPanel
    tabWorkspacesRef.current = tabWorkspaces
    contentPanelCollapsedRef.current = contentPanelCollapsed
    scheduleCurrentUiStatePersist()
  }, [
    composerAiPreference,
    composerExecutionPermission,
    composerDraftValue,
    composerMode,
    contentPanel,
    contentPanelCollapsed,
    modelSelection,
    scheduleCurrentUiStatePersist,
    selectedWorkspaceId,
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

  const saveComposerDraftForSession = useCallback(
    (sessionId: string | null, draft: ComposerDraftValue): void => {
      if (!sessionId) return
      if (isComposerDraftEmpty(draft)) {
        delete composerDraftBySessionIdRef.current[sessionId]
        return
      }
      composerDraftBySessionIdRef.current[sessionId] = draft
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

  const applySessionUiState = useCallback(
    (key: string, persisted: ChatSessionUiStateV1 | null, workspaceId?: string | null): void => {
      const state = persisted || createDefaultSessionUiState(modelSelectionRef.current, workspaceId)
      const draft = state.composer.draft
      composerModeRef.current = state.composer.mode
      composerAiPreferenceRef.current = state.composer.aiPreference
      composerExecutionPermissionRef.current =
        state.composer.executionPermission === 'full_access' ? 'full_access' : 'review'
      modelSelectionRef.current = state.composer.modelSelection
      // Session UI snapshots own the workspace selection. The legacy session column is only
      // a fallback for sessions that do not have a snapshot yet.
      selectedWorkspaceIdRef.current = persisted
        ? state.composer.workspaceId
        : (workspaceId ?? null)
      setComposerMode(state.composer.mode)
      setComposerAiPreference(state.composer.aiPreference)
      setComposerExecutionPermission(composerExecutionPermissionRef.current)
      setModelSelection(state.composer.modelSelection)
      setSelectedWorkspaceId(selectedWorkspaceIdRef.current)
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
    [applyComposerDraft, setComposerMode]
  )

  const setSessionRunningState = useCallback((sessionId: string, isRunning: boolean): void => {
    setSessions((items) =>
      items.map((item) => (item.id === sessionId ? { ...item, isRunning } : item))
    )
  }, [])

  useEffect(() => {
    const targetWindow = window as WorkbenchE2EWindow
    if (!window.api.isE2EMode()) return

    targetWindow.__NCURATOR_E2E_SET_WORKBENCH_DRAFT__ = (draft: ComposerDraftValue): void => {
      saveComposerDraftForSession(currentSessionIdRef.current, draft)
      applyComposerDraft(draft, 'e2e')
    }

    return () => {
      delete targetWindow.__NCURATOR_E2E_SET_WORKBENCH_DRAFT__
    }
  }, [applyComposerDraft, saveComposerDraftForSession])

  const kbScopeDocumentIds = useMemo(() => {
    const explicitIds = collectReferenceDocumentIds(selectedReferences)
    if (explicitIds.length > 0) return explicitIds
    if (selectedWorkspaceId) return workspaceDocumentIds
    return []
  }, [selectedReferences, selectedWorkspaceId, workspaceDocumentIds])

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  useEffect(() => {
    setSelectedReferences((current) => pruneReferencesByWorkspace(current, selectedWorkspaceId))
  }, [selectedWorkspaceId])

  useEffect(() => {
    let cancelled = false

    const loadWorkspaceDocumentIds = async (): Promise<void> => {
      if (!selectedWorkspaceId) {
        setWorkspaceDocumentIds([])
        return
      }

      const response = await window.api.referenceItemList({
        mode: 'search',
        workspaceId: selectedWorkspaceId,
        referenceKinds: ['directory', 'file', 'web']
      })
      if (!cancelled) {
        setWorkspaceDocumentIds(collectReferenceDocumentIds(response.items))
        const validReferenceKeys = new Set(response.items.map(getReferenceKey))
        setSelectedReferences((current) =>
          current.filter((reference) => validReferenceKeys.has(getReferenceKey(reference)))
        )
        setComposerContentNodes((current) =>
          current.filter(
            (node) =>
              node.kind !== 'reference' || validReferenceKeys.has(getReferenceKey(node.reference))
          )
        )
      }
    }

    void loadWorkspaceDocumentIds()
    return () => {
      cancelled = true
    }
  }, [selectedWorkspaceId])

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) || null,
    [currentSessionId, sessions]
  )
  const latestUserMessageId = useMemo(
    () => [...currentMessages].reverse().find((item) => item.role === 'user')?.id || null,
    [currentMessages]
  )

  const currentApprovalItem = useMemo(() => {
    if (!pendingApprovalBatch) return null
    return pendingApprovalBatch.items[approvalCurrentIndex] || pendingApprovalBatch.items[0] || null
  }, [approvalCurrentIndex, pendingApprovalBatch])
  const selectedWorkspaceReady = useMemo(
    () => hasWorkspaceRootPath(selectedWorkspace),
    [selectedWorkspace]
  )
  const composerSubmitDisabledReason = useMemo(() => {
    if (!input.trim()) return null
    if (switchingSessionId) return '当前会话未就绪'
    if (!selectedWorkspaceReady)
      return `${getWorkspaceRequirementHint(selectedWorkspace)}后再发送消息`
    if (composerMode === 'ai' && !modelSelection.mainModel) return '请先选择主模型'
    return null
  }, [
    composerMode,
    input,
    modelSelection.mainModel,
    selectedWorkspace,
    selectedWorkspaceReady,
    switchingSessionId
  ])

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
      !currentSessionId ||
      !hasMoreMessagesBefore ||
      loadingOlderMessages ||
      switchingSessionId ||
      currentMessages.length === 0
    ) {
      return
    }
    const beforeTimestamp = currentMessages[0]?.timestamp
    if (!beforeTimestamp) return
    setLoadingOlderMessages(true)
    const requestSessionId = currentSessionId
    try {
      const opened = await window.api.chatSessionOpen({
        sessionId: requestSessionId,
        limit: 50,
        beforeTimestamp
      })
      if (currentSessionId !== requestSessionId) return
      setHasMoreMessagesBefore(opened.hasMoreBefore)
      setCurrentMessages((previous) => appendMessagesDedupe(opened.messages, previous))
    } catch (error) {
      console.error('Failed to load older messages', error)
    } finally {
      if (currentSessionId === requestSessionId) setLoadingOlderMessages(false)
    }
  }, [
    currentMessages,
    currentSessionId,
    hasMoreMessagesBefore,
    loadingOlderMessages,
    switchingSessionId
  ])

  const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const scrollElement = event.currentTarget
    const distanceToBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
    shouldAutoScrollRef.current = distanceToBottom <= SCROLL_BOTTOM_TOLERANCE
    if (scrollElement.scrollTop <= 80) {
      void loadOlderMessages()
    }
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

  const captureBrowserTransition = useCallback(async (tabId: string): Promise<void> => {
    const response = await Promise.race([
      window.api.browserPanelCapture({ tabId }),
      new Promise<{ success: false }>((resolve) =>
        window.setTimeout(() => resolve({ success: false }), 180)
      )
    ])
    setBrowserTransitionImage(
      response.success && 'dataUrl' in response && response.dataUrl
        ? { tabId, dataUrl: response.dataUrl }
        : null
    )
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
      if ((currentSessionIdRef.current || '__draft__') !== sessionKey) {
        setBrowserTransitionImage(null)
        return
      }
      setBrowserPresentationEnabled(false)
      void window.api.browserPanelHide()
      setContentPanelCollapsed(true)
    })()
  }, [captureBrowserTransition, contentPanel, setPanelCollapsedForSession, tabWorkspaceKey])

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
      if (nextState.kind === 'empty' || nextState.kind === 'search_list') {
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
    },
    [contentPanel, expandContentPanel, updateCurrentTabWorkspace]
  )

  const openBrowserTab = useCallback(
    async (existingTabId?: string): Promise<void> => {
      const response = existingTabId
        ? await window.api.browserPanelStateGet({ tabId: existingTabId })
        : await window.api.browserTabCreate({ ownerId: currentSessionIdRef.current || '__draft__' })
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
      sessionId: string,
      update: (state: ChatSessionUiStateV1) => ChatSessionUiStateV1
    ): Promise<void> => {
      try {
        const opened = await window.api.chatSessionOpen({ sessionId, limit: 1 })
        const currentState =
          opened.uiState ||
          createDefaultSessionUiState({ mainModel: null }, opened.session?.workspace_id || null)
        await persistUiStateForKey(sessionId, update(currentState))
      } catch (error) {
        console.error('Failed to update background session UI state', error)
      }
    },
    [persistUiStateForKey]
  )

  const persistBackgroundBrowserTab = useCallback(
    (sessionId: string, browserTabId: string): void => {
      void window.api.browserPanelStateGet({ tabId: browserTabId }).then((response) => {
        if (!response.success || !response.state) return
        const browser = response.state
        const title = browser.title || browser.url || '新标签页'
        void updateBackgroundPanelState(sessionId, (state) => {
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

  const loadSessions = useCallback(async (): Promise<ChatSessionListItem[]> => {
    try {
      const list = await window.api.chatSessionList()
      setSessions(list)
      return list
    } catch (error) {
      console.error('Failed to load sessions', error)
      return []
    }
  }, [])

  const hydrateSessionView = (
    messages: ChatMessage[],
    runSnapshots: ChatSessionRunSnapshot[],
    activeRuns: ChatSessionRunSnapshot[]
  ): void => {
    assistantArtifactsRef.current = {}
    activeRunMessageIdsRef.current = {}
    setAssistantTurns(() => {
      const nextTurns: Record<string, AssistantTurnViewModel> = {}
      for (const message of messages) {
        if (message.artifacts && message.artifacts.length > 0) {
          assistantArtifactsRef.current[message.id] = message.artifacts
        }
        const turn = buildAssistantTurnFromMessage(message)
        if (turn) nextTurns[message.id] = turn
      }
      const activeRunIds = new Set(activeRuns.map((item) => item.run.id))
      for (const runSnapshot of runSnapshots) {
        activeRunSessionIdsRef.current[runSnapshot.run.id] = runSnapshot.run.sessionId
        if (activeRunIds.has(runSnapshot.run.id)) {
          activeRunMessageIdsRef.current[runSnapshot.run.id] = runSnapshot.run.assistantMessageId
        }
        const turn = buildAssistantTurnFromRunSnapshot(runSnapshot)
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

  const loadSessionOpen = async (sessionId: string, requestId: number): Promise<void> => {
    try {
      const opened = await window.api.chatSessionOpen({ sessionId, limit: 50 })
      if (sessionSwitchRequestRef.current !== requestId) return
      applySessionUiState(sessionId, opened.uiState || null, opened.session?.workspace_id)
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
      hydrateSessionView(opened.messages, opened.activeRuns, opened.activeRuns)
      setSwitchingSessionId(null)

      void window.api.chatSessionRunSummaries({ sessionId }).then((summary) => {
        if (sessionSwitchRequestRef.current !== requestId) return
        hydrateSessionView(opened.messages, summary.runs, opened.activeRuns)
        void hydrateFileChangeTargetsForSession(sessionId, opened.messages)
      })
    } catch (error) {
      if (sessionSwitchRequestRef.current === requestId) setSwitchingSessionId(null)
      console.error('Failed to open session', error)
    }
  }

  const refreshContextUsage = useCallback(async (sessionId: string | null): Promise<void> => {
    if (!sessionId) {
      setContextUsage(null)
      return
    }
    try {
      const response = await window.api.aiContextUsageGet({ sessionId })
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
    } finally {
      setWorkspacesLoaded(true)
    }
  }, [])

  const loadModelConfigs = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.llmConfigList()
      setModelConfigs(list)
      if (list.length === 0) {
        setModelListsByConfigId({})
        setModelSelection({ mainModel: null })
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
        resolveSelectedModel(list, nextLists, model)
      const firstConfigWithModel = list.find(
        (config) => (nextLists[config.id] || []).length > 0
      )
      const firstRemoteModel = firstConfigWithModel
        ? pickChatModel(nextLists[firstConfigWithModel.id])
        : undefined
      const firstModel =
        (firstConfigWithModel && firstRemoteModel
          ? {
              configId: firstConfigWithModel.id,
              modelName: firstRemoteModel.id
            }
          : null) || pickFallbackModel(list)
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
    const key = currentSessionIdRef.current || '__draft__'
    if (!modelCatalogLoaded || uiStateReadyKeyRef.current !== key) return
    const resolveModel = (
      selected: WorkbenchModelSelection['mainModel']
    ): WorkbenchModelSelection['mainModel'] =>
      resolveSelectedModel(modelConfigs, modelListsByConfigId, selected)
    const firstConfig = modelConfigs.find((config) => modelListsByConfigId[config.id]?.length)
    const firstRemote = firstConfig ? pickChatModel(modelListsByConfigId[firstConfig.id]) : undefined
    const fallback =
      (firstConfig && firstRemote
        ? {
            configId: firstConfig.id,
            modelName: firstRemote.id
          }
        : null) || pickFallbackModel(modelConfigs)
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
    const key = currentSessionIdRef.current || '__draft__'
    if (uiStateReadyKeyRef.current !== key || attachments.length === 0) return
    let cancelled = false
    const snapshot = attachments
    void Promise.all(
      snapshot.map(async (attachment) => ({
        attachment,
        exists: await window.api.fileExists(attachment.path)
      }))
    ).then((checked) => {
      if (cancelled || (currentSessionIdRef.current || '__draft__') !== key) return
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

  const handleModeChange = useCallback(
    (mode: WorkbenchMode): void => {
      uiStateInteractionVersionRef.current += 1
      composerModeRef.current = mode
      setComposerMode(mode)
      void persistCurrentUiStateNow({ requireReady: false })
    },
    [persistCurrentUiStateNow, setComposerMode]
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
      uiStateInteractionVersionRef.current += 1
      composerExecutionPermissionRef.current = permission
      setComposerExecutionPermission(permission)
      void persistCurrentUiStateNow({ requireReady: false })
    },
    [persistCurrentUiStateNow]
  )

  const handleWorkspaceChange = useCallback(
    (workspaceId: string | null): void => {
      uiStateInteractionVersionRef.current += 1
      selectedWorkspaceIdRef.current = workspaceId
      setSelectedWorkspaceId(workspaceId)
      void persistCurrentUiStateNow({ requireReady: false })
    },
    [persistCurrentUiStateNow]
  )

  const toggleWorkspaceCollapsed = useCallback((workspaceId: string): void => {
    setCollapsedWorkspaceIds((current) => {
      const next = new Set(current)
      if (next.has(workspaceId)) {
        next.delete(workspaceId)
      } else {
        next.add(workspaceId)
      }
      return next
    })
  }, [])

  const toggleWorkspaceSessionsExpanded = useCallback((workspaceId: string): void => {
    setExpandedWorkspaceSessionIds((current) => {
      const next = new Set(current)
      if (next.has(workspaceId)) {
        next.delete(workspaceId)
      } else {
        next.add(workspaceId)
      }
      return next
    })
  }, [])

  const createNewSession = useCallback(
    async (workspaceId?: string): Promise<void> => {
      // Do this before awaiting the previous draft flush so a late bootstrap response cannot
      // restore the last-opened view over an explicitly created new conversation.
      uiStateInteractionVersionRef.current += 1
      setScheduledTasksActive(false)
      await flushCurrentUiState()
      const previousDraftWorkspace = tabWorkspacesRef.current.__draft__
      for (const tab of previousDraftWorkspace?.tabs || []) {
        if (tab.kind === 'browser' && tab.browserTabId) {
          void window.api.browserTabClose({ tabId: tab.browserTabId })
        }
      }
      sessionSwitchRequestRef.current += 1
      uiStateReadyKeyRef.current = null
      setUiStateReadyKey(null)
      currentSessionIdRef.current = null
      setCurrentSessionId(null)
      setSwitchingSessionId(null)
      setCurrentMessages([])
      setAssistantTurns({})
      assistantArtifactsRef.current = {}
      activeRunMessageIdsRef.current = {}
      setHasMoreMessagesBefore(false)
      setLoadingOlderMessages(false)
      setLoading(false)
      setAiRunId(null)
      setCancellingRun(false)
      setPendingApprovalBatch(null)
      setApprovalCurrentIndex(0)
      setApprovalDraftDecisions({})
      setApprovalSubmitting(false)
      const draftState = createDefaultSessionUiState(modelSelectionRef.current, workspaceId || null)
      persistedDraftStateRef.current = draftState
      applySessionUiState('__draft__', draftState, workspaceId || null)
      setBrowserPresentationEnabled(false)
      void window.api.browserPanelHide()
      resetApplyWorkspaceState()
      setFileChangeRecords([])
      fileChangeRunScopeRef.current = null
      void refreshContextUsage(null)
      await window.api.workbenchUiStateSave({ activeViewKey: '__draft__', draftState })
    },
    [applySessionUiState, flushCurrentUiState, refreshContextUsage]
  )

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
        void loadFileChangesForSessionRef.current(nextRecord.sessionId, nextRecord.runId, {
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

  const loadFileChangesForSession = async (
    sessionId: string,
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
    const scope = createFileChangeRunScope({ sessionId, runId })
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
  loadFileChangesForSessionRef.current = loadFileChangesForSession

  const hydrateFileChangeTargetsForSession = async (
    sessionId: string,
    messages = currentMessages
  ): Promise<void> => {
    try {
      const response = await window.api.aiFileChangeList({ sessionId })
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

  const openExistingSession = async (
    session: ChatSession,
    options?: { saveCurrentDraft?: boolean }
  ): Promise<void> => {
    setScheduledTasksActive(false)
    if (session.id === currentSessionIdRef.current && !switchingSessionId) return

    uiStateInteractionVersionRef.current += 1
    if (options?.saveCurrentDraft !== false) await flushCurrentUiState()

    const requestId = sessionSwitchRequestRef.current + 1
    sessionSwitchRequestRef.current = requestId
    uiStateReadyKeyRef.current = null
    setUiStateReadyKey(null)
    currentSessionIdRef.current = session.id

    setCurrentSessionId(session.id)
    selectedWorkspaceIdRef.current = session.workspace_id
    setSelectedWorkspaceId(session.workspace_id)
    setSwitchingSessionId(session.id)
    setBrowserPresentationEnabled(false)
    void window.api.browserPanelHide()
    restoreContentPanelWithoutAnimationRef.current = false
    resetApplyWorkspaceState()

    await window.api.workbenchUiStateSave({
      activeViewKey: session.id,
      draftState: persistedDraftStateRef.current
    })
    void loadSessionOpen(session.id, requestId)
    setFileChangeRecords([])
    fileChangeRunScopeRef.current = null
    void refreshContextUsage(session.id)
  }

  const adoptCreatedSession = (session: ChatSession): void => {
    sessionSwitchRequestRef.current += 1
    currentSessionIdRef.current = session.id
    const draftWorkspace = tabWorkspacesRef.current.__draft__ || EMPTY_TAB_WORKSPACE
    const nextTabWorkspaces = { ...tabWorkspacesRef.current, [session.id]: draftWorkspace }
    delete nextTabWorkspaces.__draft__
    tabWorkspacesRef.current = nextTabWorkspaces
    setTabWorkspaces(nextTabWorkspaces)
    if (panelFallbackByKeyRef.current.__draft__) {
      panelFallbackByKeyRef.current[session.id] = panelFallbackByKeyRef.current.__draft__
      delete panelFallbackByKeyRef.current.__draft__
    }
    uiStateReadyKeyRef.current = session.id
    setUiStateReadyKey(session.id)
    persistedDraftStateRef.current = null
    setSessions((items) => [
      { ...session, isRunning: false, hasUnreadCompletion: false },
      ...items.filter((item) => item.id !== session.id)
    ])
    setCurrentSessionId(session.id)
    selectedWorkspaceIdRef.current = session.workspace_id
    setSelectedWorkspaceId(session.workspace_id)
    setSwitchingSessionId(null)
    setHasMoreMessagesBefore(false)
    setLoadingOlderMessages(false)
    void refreshContextUsage(session.id)
  }

  const selectSession = (session: ChatSessionListItem): void => {
    setSessions((items) =>
      items.map((item) => (item.id === session.id ? { ...item, hasUnreadCompletion: false } : item))
    )
    void window.api.chatSessionMarkViewed(session.id).then((response) => {
      if (!response.success) void loadSessions()
    })
    void openExistingSession(session)
  }

  useEffect(() => {
    const openNotificationSession = async (sessionId: string): Promise<void> => {
      const session = sessions.find((item) => item.id === sessionId)
      if (session) {
        selectSession(session)
        return
      }
      const loadedSessions = await loadSessions()
      const loadedSession = loadedSessions.find((item) => item.id === sessionId)
      if (loadedSession) selectSession(loadedSession)
    }
    const pendingSessionId = window.sessionStorage.getItem('ncurator.pending-notification-session')
    if (pendingSessionId) {
      window.sessionStorage.removeItem('ncurator.pending-notification-session')
      void openNotificationSession(pendingSessionId)
    }
    return window.api.onSystemNotificationOpenSession(openNotificationSession)
    // Session selection intentionally uses the current list captured by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  const acknowledgeCurrentSessionCompletion = useCallback((): void => {
    const sessionId = currentSessionIdRef.current
    if (
      !sessionId ||
      !sessions.some((session) => session.id === sessionId && session.hasUnreadCompletion)
    ) {
      return
    }

    setSessions((items) =>
      items.map((item) => (item.id === sessionId ? { ...item, hasUnreadCompletion: false } : item))
    )
    void window.api.chatSessionMarkViewed(sessionId).then((response) => {
      if (!response.success) void loadSessions()
    })
  }, [loadSessions, sessions])

  useEffect(() => {
    const bootstrapInteractionVersion = uiStateInteractionVersionRef.current
    void (async () => {
      const [, , list, workbenchStateResponse] = await Promise.all([
        loadWorkspaces(),
        loadModelConfigs(),
        loadSessions(),
        window.api.workbenchUiStateGet()
      ])
      if (sessionListHydratedRef.current) return
      sessionListHydratedRef.current = true
      // A user may create or open a conversation before all startup requests resolve. In that
      // case the in-memory state is newer than the persisted startup snapshot.
      if (uiStateInteractionVersionRef.current !== bootstrapInteractionVersion) return
      const workbenchState = workbenchStateResponse.state
      persistedDraftStateRef.current = workbenchState.draftState
      const savedSession = list.find((item) => item.id === workbenchState.activeViewKey)
      if (savedSession) {
        await openExistingSession(savedSession, { saveCurrentDraft: false })
        return
      }
      if (workbenchState.activeViewKey === '__draft__' || list.length === 0) {
        currentSessionIdRef.current = null
        setCurrentSessionId(null)
        applySessionUiState(
          '__draft__',
          persistedDraftStateRef.current || workbenchState.draftState
        )
        return
      }
      const firstSession = list[0]
      if (firstSession) await openExistingSession(firstSession, { saveCurrentDraft: false })
    })()
    // Initial bootstrap is intentionally explicit. Later list refreshes must not reopen sessions.
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

  const requestDeleteSession = (event: React.MouseEvent, session: ChatSession): void => {
    event.stopPropagation()
    setDeleteConfirmSession(session)
  }

  const confirmDeleteSession = async (): Promise<void> => {
    const session = deleteConfirmSession
    if (!session || deletingSessionIds.has(session.id)) return
    const id = session.id
    setDeletingSessionIds((current) => new Set(current).add(id))
    try {
      const response = await window.api.chatSessionDelete(id)
      if (!response.success) {
        emitErrorMessage(response.error || '删除会话失败')
        return
      }
      const remainingSessions = sessions.filter((item) => item.id !== id)
      const retryTimer = persistRetryTimersRef.current[id]
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      delete persistRetryTimersRef.current[id]
      delete persistRevisionsRef.current[id]
      delete composerDraftBySessionIdRef.current[id]
      setTabWorkspaces((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setSessions(remainingSessions)
      if (currentSessionIdRef.current === id) {
        const nextSession = remainingSessions[0] || null
        if (nextSession) {
          void openExistingSession(nextSession, { saveCurrentDraft: false })
        } else {
          createNewSession()
        }
      }
      setDeleteConfirmSession(null)
      void loadSessions()
    } catch (error) {
      console.error(error)
      emitErrorMessage('删除会话失败')
    } finally {
      setDeletingSessionIds((current) => {
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
    async (reference: {
      kind: ParsedNcuratorRefKind
      resourceType: ParsedNcuratorRefResourceType
      label: string
      path: string
    }): Promise<void> => {
      if (reference.resourceType === 'web') {
        const response = await window.api.openExternal(reference.path)
        if (!response.success) {
          emitErrorMessage(response.error || '打开链接失败')
        }
        return
      }

      await openFile({
        path: reference.path,
        fileName: reference.label,
        origin: reference.kind === 'reference' ? 'source' : 'read'
      })
    },
    [emitErrorMessage, openFile]
  )

  const handleOpenMarkdownReference = useCallback(
    (reference: {
      kind: ParsedNcuratorRefKind
      resourceType: ParsedNcuratorRefResourceType
      label: string
      path: string
    }): void => {
      void openMarkdownReference(reference)
    },
    [openMarkdownReference]
  )

  const openSearchResult = async (
    turn: SearchWorkbenchTurn,
    resultIndex: number
  ): Promise<void> => {
    const result = turn.results[resultIndex]
    if (!result) return
    if (result.source_type === 'web') {
      const url = result.document?.file_path
      if (!url) {
        message.warning('未找到网页链接')
        return
      }
      const response = await window.api.openExternal(url)
      if (!response.success) {
        emitErrorMessage(response.error || '打开链接失败')
      }
      return
    }

    const fileRef = getSearchResultFileRef(result)
    if (!fileRef) {
      message.warning('未找到文件路径')
      return
    }
    await openFile(fileRef, {
      kind: 'search_list',
      title: '搜索结果',
      query: turn.query,
      results: turn.results,
      tokens: turn.tokens
    })
  }

  const openFileChange = useCallback((changeId: string): void => {
    void window.api.aiFileChangeGet({ changeId }).then((response) => {
      if (response.record) {
        void loadFileChangesForSessionRef.current(
          response.record.sessionId,
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
        activeRunSessionIdsRef.current[event.runId] = event.sessionId
        setSessionRunningState(event.sessionId, true)
      }
      const eventSessionId = activeRunSessionIdsRef.current[event.runId]

      if (
        event.type === 'run_completed' ||
        event.type === 'run_failed' ||
        event.type === 'run_cancelled' ||
        (!event.internal && event.type === 'runtime_issue')
      ) {
        if (eventSessionId) {
          setSessionRunningState(eventSessionId, false)
          delete activeRunSessionIdsRef.current[event.runId]
        }
        void loadSessions()
      }

      const messageId = activeRunMessageIdsRef.current[event.runId]
      if (!messageId) {
        if (event.type === 'run_started' && event.sessionId === currentSessionIdRef.current) {
          const requestId = sessionSwitchRequestRef.current + 1
          sessionSwitchRequestRef.current = requestId
          void loadSessionOpen(event.sessionId, requestId)
        }
        return
      }

      if (eventSessionId !== currentSessionIdRef.current) {
        if (event.type === 'browser_panel_opened' && eventSessionId) {
          persistBackgroundBrowserTab(eventSessionId, event.browserTabId)
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

      if (event.type === 'runtime_issue') {
        if (!event.internal) {
          setLoading(false)
          if (event.code === 'approval_denied') {
            setPendingApprovalBatch(null)
            setApprovalCurrentIndex(0)
            setApprovalDraftDecisions({})
            setApprovalSubmitting(false)
          }
          message.warning(event.message || '当前运行被阻塞')
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
          message.info(`有 ${event.items.length} 条命令需要审核`)
        }
        return
      }

      if (event.type === 'approval_batch_decision') {
        if (event.internal) return
        setApprovalSubmitting(false)
        const allApproved = event.decisions.every((decision) => decision.action === 'approve')
        if (allApproved) {
          setLoading(true)
          message.success('审核已通过')
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
        const errorText = formatRunFailureMessage(event)
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
        if (eventSessionId && eventSessionId === currentSessionIdRef.current) {
          void loadFileChangesForSessionRef.current(eventSessionId, event.runId)
        }
        emitErrorMessage(
          event.code === 'runtime_limit'
            ? '已达到运行上限，可继续对话推进'
            : event.code === 'output_truncated'
              ? '模型输出达到长度限制，可发送“继续”接着完成'
              : event.code === 'input_too_long'
                ? '当前输入超过模型上下文限制，请缩短后重试'
              : event.source === 'provider'
                ? '模型请求失败'
                : '运行失败'
        )
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
        if (eventSessionId && eventSessionId === currentSessionIdRef.current) {
          void loadFileChangesForSessionRef.current(eventSessionId, event.runId)
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
        if (eventSessionId && eventSessionId === currentSessionIdRef.current) {
          void loadFileChangesForSessionRef.current(eventSessionId, event.runId, {
            notifyNoEffectiveChange: true
          })
        }
        void refreshContextUsage(eventSessionId || currentSessionIdRef.current)
      }
    })
    return () => {
      unsubscribe()
    }
    // AI run listener is intentionally keyed by active run/session identity to avoid resubscribing on UI helper changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, loadSessions, message, refreshContextUsage, setSessionRunningState])

  useEffect(() => {
    return window.api.onChatSessionListRefresh(() => {
      void loadSessions()
    })
  }, [loadSessions])

  const createDraftSessionForSubmit = (workspace: WorkspaceSource): ChatSession => {
    return {
      id: crypto.randomUUID(),
      title: '新对话',
      created_at: Date.now(),
      workspace_id: workspace.id
    }
  }

  const ensureAttachmentTarget = useCallback(async (): Promise<{
    assetBucketId: string
    workspaceRootPath: string
  } | null> => {
    if (!selectedWorkspaceReady || !selectedWorkspace?.root_path) {
      message.warning(`${getWorkspaceRequirementHint(selectedWorkspace)}后再添加附件`)
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
      assetBucketId: nextAssetBucketId,
      workspaceRootPath: selectedWorkspace.root_path
    }
  }, [assetBucketId, message, selectedWorkspace, selectedWorkspaceReady])

  const handleSend = async (): Promise<void> => {
    if (composerMode === 'ai' && aiRunId) {
      await handleCancel()
      return
    }
    if (composerMode === 'search') {
      await handleSearchSend()
      return
    }
    if (!input.trim() || loading || submitInFlightRef.current) return
    if (!selectedWorkspaceReady || !selectedWorkspace) {
      message.warning(`${getWorkspaceRequirementHint(selectedWorkspace)}后再发送消息`)
      return
    }
    if (!modelSelection.mainModel) {
      message.warning('请先在输入框右下角选择主模型')
      return
    }

    const userQuery = input.trim()
    const submittedContentNodes = composerContentNodes
    const submittedReferences = selectedReferences
    const submittedAttachments = attachments
    let submitSessionId = currentSessionId
    let createdSession: ChatSession | null = null
    if (!submitSessionId) {
      createdSession = {
        id: crypto.randomUUID(),
        title: '新对话',
        created_at: Date.now(),
        workspace_id: selectedWorkspace.id
      }
      submitSessionId = createdSession.id
    }
    const optimisticUserMessage: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      session_id: submitSessionId,
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
      session_id: submitSessionId,
      role: 'assistant',
      content: '',
      timestamp: optimisticUserMessage.timestamp + 1,
      error: false
    }
    const likelyExecutable =
      /\b(cmd|bash|shell|terminal|command|run)\b/i.test(userQuery) ||
      /终端|命令|脚本|执行|创建文件|删除文件|修改文件/.test(userQuery)
    if (likelyExecutable && !selectedWorkspaceReady) {
      message.warning('该请求可能触发本地执行，请先选择当前工作区，必要时再通过 @ 插入文件或目录')
      return
    }
    const removeOptimisticMessages = (messages: ChatMessage[]): ChatMessage[] =>
      messages.filter(
        (message) =>
          message.id !== optimisticUserMessage.id && message.id !== optimisticAssistantMessage.id
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

    saveComposerDraftForSession(submitSessionId, createEmptyComposerDraft())
    applyComposerDraft(createEmptyComposerDraft(), `clear:${submitSessionId}`)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setCancellingRun(false)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)
    lastSubmittedInputRef.current = userQuery
    setCurrentMessages((previous) =>
      appendMessagesDedupe(previous, [optimisticUserMessage, optimisticAssistantMessage])
    )
    setAssistantTurns((previous) => ({
      ...previous,
      [optimisticAssistantMessage.id]: createThinkingAssistantTurn(optimisticAssistantMessage.id)
    }))

    submitInFlightRef.current = true
    try {
      if (createdSession) {
        await flushCurrentUiState()
        const sessionResponse = await window.api.chatSessionSave(createdSession)
        if (!sessionResponse.success) {
          failOptimisticSubmit(sessionResponse.error || '创建会话失败')
          return
        }
        adoptCreatedSession(createdSession)
      }

      const response = await window.api.chatSubmit({
        mode: 'ai',
        sessionId: submitSessionId,
        input: userQuery,
        preference: composerAiPreference,
        executionPermission: composerExecutionPermission,
        contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
        selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
        attachments: submittedAttachments.length > 0 ? submittedAttachments : undefined,
        mainModel: modelSelection.mainModel,
        workspace: createWorkspaceBinding(selectedWorkspace)
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
      activeRunSessionIdsRef.current[run.id] = run.sessionId
      assistantArtifactsRef.current[assistantMessageId] = []
      setCurrentMessages((previous) =>
        appendMessagesDedupe(removeOptimisticMessages(previous), [
          response.userMessage,
          response.assistantMessage
        ])
      )
      setAiRunId(run.id)
      setLoading(true)
      setSessionRunningState(run.sessionId, true)
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
      void loadSessions()
    } catch (error) {
      console.error(error)
      failOptimisticSubmit(error instanceof Error ? error.message : '发送失败')
    } finally {
      submitInFlightRef.current = false
    }
  }

  const handleSearchSend = async (): Promise<void> => {
    if (!input.trim() || loading) return
    if (!selectedWorkspaceReady || !selectedWorkspace) {
      message.warning(`${getWorkspaceRequirementHint(selectedWorkspace)}后再发送消息`)
      return
    }

    const userQuery = input.trim()
    const submittedContentNodes = composerContentNodes
    const submittedReferences = selectedReferences
    const hasStrictScope = selectedReferences.length > 0 || Boolean(selectedWorkspace)
    if (hasStrictScope && kbScopeDocumentIds.length === 0) {
      message.warning('当前搜索范围没有已索引资料，无法执行纯搜索。')
      return
    }
    let submitSessionId = currentSessionId
    let createdSession: ChatSession | null = null
    if (!submitSessionId) {
      createdSession = createDraftSessionForSubmit(selectedWorkspace)
      submitSessionId = createdSession.id
    }

    saveComposerDraftForSession(submitSessionId, createEmptyComposerDraft())
    applyComposerDraft(createEmptyComposerDraft(), `clear:${submitSessionId}`)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setLoading(true)
    setCancellingRun(false)
    setAiRunId(null)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)

    try {
      if (createdSession) {
        await flushCurrentUiState()
        const sessionResponse = await window.api.chatSessionSave(createdSession)
        if (!sessionResponse.success) {
          emitErrorMessage(sessionResponse.error || '创建会话失败')
          return
        }
      }
      const response = await window.api.chatSubmit({
        mode: 'search',
        sessionId: submitSessionId,
        input: userQuery,
        contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
        selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
        workspace: createWorkspaceBinding(selectedWorkspace),
        searchDocumentIds: hasStrictScope ? kbScopeDocumentIds : undefined
      })
      if (!response.success || !response.userMessage || !response.assistantMessage) {
        if (createdSession) await window.api.chatSessionDelete(createdSession.id).catch(() => null)
        emitErrorMessage(response.error || '搜索失败')
        return
      }
      const results = response.results || []
      const assistantContent = response.content || response.assistantMessage.content
      const completedAssistantMessageId = response.assistantMessage.id
      setCurrentMessages((previous) =>
        appendMessagesDedupe(previous, [response.userMessage, response.assistantMessage])
      )
      if (createdSession) adoptCreatedSession(createdSession)
      setAssistantTurns((previous) => ({
        ...previous,
        [completedAssistantMessageId]: {
          ...(previous[completedAssistantMessageId] ||
            createSearchAssistantTurn(completedAssistantMessageId)),
          status: 'completed',
          processGroups: completeAssistantProcessGroups(
            previous[completedAssistantMessageId]?.processGroups ||
              createSearchAssistantTurn(completedAssistantMessageId).processGroups
          ),
          finalAnswerMarkdown: assistantContent
        }
      }))

      showContentPanel({
        kind: 'search_list',
        title: '搜索结果',
        query: userQuery,
        results,
        tokens: response.tokens || []
      })
      void loadSessions()
    } catch (error) {
      console.error(error)
      if (createdSession) await window.api.chatSessionDelete(createdSession.id).catch(() => null)
      emitErrorMessage('搜索失败')
    } finally {
      setLoading(false)
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
    if (!activeApplyRecord || !currentSessionId || applyReverting) return
    setApplyRevertConfirm({
      changeId: activeApplyRecord.id,
      stage: 'confirm',
      content: '文件将恢复到这次修改发生前的状态。'
    })
  }

  const handleApplyRevertConfirm = async (): Promise<void> => {
    if (!applyRevertConfirm || !currentSessionId || applyReverting) return
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
      await loadFileChangesForSession(record.sessionId, record.runId, {
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
    if (!currentSessionId || aiRunId || messageItem.id !== latestUserMessageId) return
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
    saveComposerDraftForSession(currentSessionId, draft)
    applyComposerDraft(draft, `edit:${messageItem.id}`)
    shouldAutoScrollRef.current = true
    try {
      const response = await window.api.chatTurnRetractLatest({
        sessionId: currentSessionId,
        userMessageId: messageItem.id
      })
      if (!response.success || !response.userMessage) {
        setCurrentMessages(previousMessages)
        setAssistantTurns(previousAssistantTurns)
        assistantArtifactsRef.current = previousAssistantArtifacts
        if (composerDraftValueRef.current.input === draft.input) {
          saveComposerDraftForSession(currentSessionId, previousDraft)
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
      void refreshContextUsage(currentSessionId)
    } catch (error) {
      console.error(error)
      setCurrentMessages(previousMessages)
      setAssistantTurns(previousAssistantTurns)
      assistantArtifactsRef.current = previousAssistantArtifacts
      if (composerDraftValueRef.current.input === draft.input) {
        saveComposerDraftForSession(currentSessionId, previousDraft)
        applyComposerDraft(previousDraft, `edit-failed:${messageItem.id}`)
      }
      emitErrorMessage('编辑失败')
    }
  }

  const renderUserMessage = (messageItem: ChatMessage): React.ReactNode => {
    const contentNodes = getUserMessageContentNodes(messageItem)
    const canEdit = Boolean(currentSessionId) && !aiRunId && messageItem.id === latestUserMessageId
    return (
      <div
        key={messageItem.id}
        className="group/user-message flex justify-end"
        data-testid={`${workbenchSelectors.userMessagePrefix}-${messageItem.id}`}
      >
        <div className="flex min-w-0 max-w-[66%] flex-col items-end">
          {messageItem.attachments && messageItem.attachments.length > 0 ? (
            <div className="mb-2 flex max-w-full flex-nowrap justify-end gap-2 overflow-x-auto pb-1">
              {messageItem.attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  className={`shrink-0 border border-[#E0DFDC] bg-white text-left shadow-none transition hover:border-[#CFCFCC] ${
                    attachment.kind === 'image'
                      ? 'h-[74px] w-[74px] overflow-hidden rounded-[12px] p-0'
                      : 'flex max-w-[260px] items-center gap-2 rounded-[10px] px-2 py-1.5'
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
                      <AttachmentFileIcon fileName={attachment.name} className="h-9 w-9" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium leading-5 text-[#37352F]">
                          {attachment.name}
                        </span>
                        <span className="block text-[12px] leading-4 text-[#787774]">
                          {getAttachmentTypeLabel(attachment.name)}
                        </span>
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          ) : null}
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
                        ? `${index}:web:${node.reference.workspaceId}:${node.reference.webSourceId}`
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
            <span>{formatUserMessageTime(messageItem.timestamp)}</span>
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
    )
  }

  const renderAssistantMessage = (messageItem: ChatMessage): React.ReactNode => {
    const turn = assistantTurns[messageItem.id]
    if (!turn) {
      return (
        <div key={messageItem.id} className="w-full">
          <div className="min-w-0 text-[15px] leading-7 text-[#37352F]">
            <MarkdownRenderer
              content={messageItem.content}
              onOpenReference={handleOpenMarkdownReference}
            />
          </div>
        </div>
      )
    }

    return (
      <AssistantTurnCard
        key={messageItem.id}
        messageId={messageItem.id}
        turn={turn}
        isStreaming={loading && Boolean(turn.runId && turn.runId === aiRunId)}
        onOpenApply={openFileChange}
        workspaces={workspaces}
        fallbackWorkspaceName={selectedWorkspace?.name || null}
        onOpenReference={handleOpenMarkdownReference}
      />
    )
  }

  const handleComposerDraftChange = useCallback(
    (draft: ComposerDraftValue) => {
      setInput(draft.input)
      setComposerContentNodes(draft.contentNodes)
      setSelectedReferences(draft.selectedReferences)
      setAttachments(draft.attachments || [])
      setAssetBucketId(draft.assetBucketId || null)
      saveComposerDraftForSession(currentSessionId, draft)
    },
    [currentSessionId, saveComposerDraftForSession]
  )

  // 按工作空间分组会话
  const sessionsByWorkspace = useMemo(() => {
    const groups = new Map<string, ChatSessionListItem[]>()
    sessions.forEach((session) => {
      const wsId = session.workspace_id || ''
      if (!groups.has(wsId)) {
        groups.set(wsId, [])
      }
      groups.get(wsId)!.push(session)
    })
    return groups
  }, [sessions])

  const sessionSwitching = Boolean(switchingSessionId)
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

  // 获取平台信息
  const [platform, setPlatform] = useState<string>(() => detectRendererPlatform())
  useEffect(() => {
    setPlatform(detectRendererPlatform())
  }, [])

  return (
    <div
      className="nc-app-shell"
      data-testid={workbenchSelectors.page}
      data-workbench-mode={composerMode}
      onClick={acknowledgeCurrentSessionCompletion}
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
          data-testid={workbenchSelectors.sessionsToggle}
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
            onClick={() => void createNewSession()}
            data-testid={workbenchSelectors.newSessionButton}
            aria-label="新对话"
          >
            <HiOutlinePencilSquare className="h-[18px] w-[18px] shrink-0 text-[#787774]" />
            <span>新对话</span>
          </button>
          <button
            type="button"
            className={`nc-sidebar-nav-row ${scheduledTasksActive ? 'nc-sidebar-item-active' : ''}`}
            onClick={() => void openScheduledTasks()}
            data-testid={workbenchSelectors.scheduledTasksButton}
            aria-label="定时任务"
          >
            <HiOutlineClock className="h-[18px] w-[18px] shrink-0 text-[#787774]" />
            <span>定时任务</span>
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto px-2 py-2"
          data-testid={workbenchSelectors.sessionsList}
        >
          {workspacesLoaded ? (
            <div className="group flex items-center justify-between gap-2 px-3 pb-1 pt-2 text-[12px] font-medium text-[#8F8E8B]">
              <span className="truncate">工作空间</span>
              <Tooltip title="添加工作空间" placement="right">
                <button
                  type="button"
                  className="workbench-no-drag flex h-5 w-5 items-center justify-center rounded-[5px] text-[#91918E] opacity-0 transition hover:bg-white hover:text-[#37352F] group-hover:opacity-100"
                  onClick={openWorkspaceSettings}
                  aria-label="添加工作空间"
                >
                  <HiOutlineFolderPlus className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          ) : null}
          {workspaces.map((workspace) => {
            const workspaceSessions = sessionsByWorkspace.get(workspace.id) || []
            const workspaceCollapsed = collapsedWorkspaceIds.has(workspace.id)
            const workspaceSessionsExpanded = expandedWorkspaceSessionIds.has(workspace.id)
            const visibleWorkspaceSessions = workspaceSessions.slice(
              0,
              COLLAPSED_WORKSPACE_SESSION_LIMIT
            )
            const overflowWorkspaceSessions = workspaceSessions.slice(
              COLLAPSED_WORKSPACE_SESSION_LIMIT
            )
            const hasOverflowSessions = overflowWorkspaceSessions.length > 0
            const renderSession = (session: ChatSessionListItem): React.JSX.Element => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                data-testid={`${workbenchSelectors.sessionItemPrefix}-${session.id}`}
                className={`nc-sidebar-item group relative ${
                  currentSessionId === session.id ? 'nc-sidebar-item-active' : 'bg-transparent'
                } ${
                  deletingSessionIds.has(session.id) ? 'pointer-events-none opacity-60' : ''
                } px-3 py-2`}
                onClick={() => selectSession(session)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectSession(session)
                  }
                }}
              >
                <div className="flex min-w-0 items-center gap-2 pl-4">
                  <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#37352F]">
                    {session.title}
                  </div>
                  <div className="flex h-4 shrink-0 items-center gap-1 text-[11px] text-[#91918E] group-hover:hidden">
                    {session.isRunning ? (
                      <span className="nc-session-running-spinner" aria-label="任务运行中" />
                    ) : session.hasUnreadCompletion ? (
                      <span className="nc-session-unread-dot" aria-label="任务已完成，未查看" />
                    ) : (
                      <>
                        <HiClock className="h-3 w-3" />
                        <span>{formatRelativeTime(session.created_at)}</span>
                      </>
                    )}
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<HiTrash className="h-3.5 w-3.5" />}
                    className="!absolute !right-1 !top-1/2 !z-10 !h-6 !w-6 !-translate-y-1/2 !rounded-[6px] !p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    loading={deletingSessionIds.has(session.id)}
                    disabled={deletingSessionIds.has(session.id)}
                    data-testid={`${workbenchSelectors.sessionDeleteButtonPrefix}-${session.id}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => requestDeleteSession(event, session)}
                  />
                </div>
              </div>
            )
            return (
              <div key={workspace.id} className="nc-sidebar-workspace-group">
                <div className="nc-sidebar-workspace-header group">
                  <div
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    onClick={() => toggleWorkspaceCollapsed(workspace.id)}
                  >
                    <HiFolder className="h-4 w-4 shrink-0 text-[#91918E]" />
                    <span className="truncate">{workspace.name}</span>
                    <button
                      type="button"
                      className="nc-sidebar-workspace-collapse workbench-no-drag relative z-10 cursor-pointer"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleWorkspaceCollapsed(workspace.id)
                      }}
                      aria-label={
                        workspaceCollapsed
                          ? `展开 ${workspace.name} 的对话`
                          : `折叠 ${workspace.name} 的对话`
                      }
                    >
                      <HiChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-150 ${
                          workspaceCollapsed ? '-rotate-90' : ''
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-[5px] text-[#91918E] opacity-0 transition hover:bg-white hover:text-[#37352F] group-hover:opacity-100"
                      onClick={() => void createNewSession(workspace.id)}
                      aria-label={`在 ${workspace.name} 中新建对话`}
                    >
                      <HiPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {workspaceCollapsed ? null : (
                  <div className="mt-1 flex flex-col gap-1">
                    {visibleWorkspaceSessions.map(renderSession)}
                    {hasOverflowSessions ? (
                      <div
                        className={`nc-sidebar-session-overflow ${
                          workspaceSessionsExpanded ? 'nc-sidebar-session-overflow-expanded' : ''
                        }`}
                        aria-hidden={!workspaceSessionsExpanded}
                        inert={!workspaceSessionsExpanded}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="flex flex-col gap-1">
                            {overflowWorkspaceSessions.map(renderSession)}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {hasOverflowSessions ? (
                      <button
                        type="button"
                        className="nc-sidebar-session-toggle workbench-no-drag"
                        onClick={() => toggleWorkspaceSessionsExpanded(workspace.id)}
                        data-testid={`${workbenchSelectors.workspaceSessionTogglePrefix}-${workspace.id}`}
                        aria-expanded={workspaceSessionsExpanded}
                        aria-label={
                          workspaceSessionsExpanded
                            ? `收起 ${workspace.name} 的对话`
                            : `展开 ${workspace.name} 的其余 ${overflowWorkspaceSessions.length} 个对话`
                        }
                      >
                        <span>
                          {workspaceSessionsExpanded
                            ? '收起'
                            : `展开其余 ${overflowWorkspaceSessions.length} 个`}
                        </span>
                        <HiChevronDown
                          className={`h-3.5 w-3.5 transition-transform duration-150 ${
                            workspaceSessionsExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
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
          <ScheduledTasksView />
        ) : (
          <>
            <div className="flex h-full min-h-0 overflow-hidden">
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
                  {currentSession ? (
                    <div className="flex min-w-0 items-center gap-2 leading-none">
                      <div className="nc-topbar-title-text truncate text-sm font-semibold leading-none text-[#37352F]">
                        {currentSession.title}
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
              <div className="flex h-full min-h-0 min-w-0 flex-1">
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
                      {isNewSession ? (
                        <div className="mb-8 flex items-center justify-center text-center text-[28px] font-normal tracking-[-0.02em] text-[#37352F]">
                          <span>
                            {composerMode === 'search' ? '俺只会搜索本地资料！！' : '找俺干啥？'}
                          </span>
                        </div>
                      ) : null}
                      {composerMode === 'ai' && pendingApprovalBatch ? (
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
                        <WorkbenchComposer
                          mode={composerMode}
                          onModeChange={handleModeChange}
                          aiPreference={composerAiPreference}
                          onAiPreferenceChange={handleAiPreferenceChange}
                          executionPermission={composerExecutionPermission}
                          onExecutionPermissionChange={handleExecutionPermissionChange}
                          modelConfigs={modelConfigs}
                          modelListsByConfigId={modelListsByConfigId}
                          modelSelection={modelSelection}
                          onModelSelectionChange={handleModelSelectionChange}
                          onRefreshModelLists={refreshModelLists}
                          workspaces={workspaces}
                          selectedWorkspaceId={selectedWorkspaceId}
                          onWorkspaceChange={handleWorkspaceChange}
                          onWorkspaceEmptyAction={openWorkspaceSettings}
                          showWorkspaceSelector={isNewSession}
                          onDraftChange={handleComposerDraftChange}
                          onSubmit={() => void handleSend()}
                          onCancel={() => void handleCancel()}
                          onPreviewImage={setPreviewImage}
                          loading={loading}
                          cancelling={cancellingRun}
                          canSubmit={Boolean(
                            input.trim() &&
                            selectedWorkspaceReady &&
                            (composerMode === 'search' || modelSelection.mainModel)
                          )}
                          submitDisabledReason={composerSubmitDisabledReason}
                          showCancel={composerMode === 'ai' && Boolean(aiRunId)}
                          draftValue={composerDraftValue}
                          draftKey={composerDraftKey}
                          contextUsage={contextUsage}
                          plan={composerPlan}
                          requestAttachmentTarget={ensureAttachmentTarget}
                          onFileDropHandlerReady={(handler) => {
                            composerFileDropHandlerRef.current = handler
                          }}
                        />
                      )}

                      {composerMode === 'search' &&
                      selectedReferences.some(
                        (reference) =>
                          reference.kind === 'directory' && reference.kbAvailability === 'partial'
                      ) ? (
                        <div
                          className="nc-notice nc-notice-warning mt-3"
                          data-testid={workbenchSelectors.referenceSearchWarning}
                        >
                          <HiOutlineExclamationCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>当前搜索范围包含部分可检索目录，搜索只会覆盖其已索引子文件。</span>
                        </div>
                      ) : null}
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
            <div
              className="min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
              data-testid={workbenchSelectors.contentPanelShell}
              data-panel-visible={contentPanelShellVisible ? 'true' : 'false'}
              style={{ width: contentPanelShellVisible ? '48vw' : 0 }}
            >
              <div
                className="h-full transition-[transform,opacity] duration-200 ease-out"
                style={{
                  width: '48vw',
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
                  fallbackWorkspaceName={selectedWorkspace?.name || null}
                  selectedWorkspace={selectedWorkspace || null}
                  fileChangeRecords={fileChangeRecords}
                  onOpenSearchResult={(turn, resultIndex) =>
                    void openSearchResult(turn, resultIndex)
                  }
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
          ) : null}
        </div>
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
          open={Boolean(deleteConfirmSession)}
          title="删除这个会话？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{
            danger: true,
            'data-testid': workbenchSelectors.sessionDeleteConfirmButton
          }}
          cancelButtonProps={{
            'data-testid': workbenchSelectors.sessionDeleteCancelButton
          }}
          confirmLoading={Boolean(
            deleteConfirmSession && deletingSessionIds.has(deleteConfirmSession.id)
          )}
          onOk={() => void confirmDeleteSession()}
          onCancel={() => {
            if (deleteConfirmSession && deletingSessionIds.has(deleteConfirmSession.id)) return
            setDeleteConfirmSession(null)
          }}
          data-testid={workbenchSelectors.sessionDeleteConfirmModal}
        >
          <p className="text-sm leading-6 text-[#787774]">
            删除后会清掉这条会话里的消息、记忆和恢复进度。这个操作不能撤回。
          </p>
          {deleteConfirmSession ? (
            <div className="mt-3 rounded-[6px] border border-[#EEEEEC] bg-[#F7F7F5] px-3 py-2 text-sm font-medium text-[#37352F]">
              {deleteConfirmSession.title || '未命名会话'}
            </div>
          ) : null}
        </Modal>
          </>
        )}
      </div>
    </div>
  )
}

export default ChatPage
