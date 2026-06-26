import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Modal, Spin } from 'antd'
import {
  HiArrowUp,
  HiCheck,
  HiChevronDown,
  HiChevronLeft,
  HiChevronRight,
  HiClock,
  HiFolder,
  HiOutlineExclamationCircle,
  HiOutlinePencilSquare,
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
  ChatMessage,
  ChatMessageContentNode,
  ChatSession,
  ChatSessionRunSnapshot,
  DocxApplyRecord,
  LLMConfig,
  LlmRemoteModel,
  SelectedReference,
  WorkspaceSource,
  WorkspaceRuntimeBinding
} from '../../../shared/types'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useNavigate } from 'react-router-dom'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import AssistantTurnCard from '../components/workbench/AssistantTurnCard'
import WorkbenchComposer from '../components/workbench/WorkbenchComposer'
import WorkbenchContentPanel from '../components/workbench/WorkbenchContentPanel'
import ReferenceInlineToken from '../components/workbench/composer/ReferenceInlineToken'
import {
  WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY,
  WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH,
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
  extractSearchResultsFromToolOutput,
  formatRelativeTime,
  getSearchResultFileRef,
  readWorkbenchModePreference,
  reduceAssistantProcessGroups,
  reduceAssistantProcessThoughts,
  readWorkbenchModelPreference,
  readWorkbenchWorkspacePreference,
  resolveWorkbenchModelSelection,
  resolveWorkbenchWorkspaceSelection,
  writeWorkbenchModePreference,
  writeWorkbenchModelPreference,
  writeWorkbenchWorkspacePreference
} from '../components/workbench/utils'
import {
  groupApplyTargetsByRunId,
  mergeApplyTargets
} from '../components/workbench/applyTargetUtils'
import { chatSelectors, workbenchSelectors } from '../testing/selectors'
import WindowsTitleBar from '../components/WindowsTitleBar'
import SidebarPanelIcon from '../components/SidebarPanelIcon'
import { collectReferenceDocumentIds, pruneReferencesByWorkspace } from '../utils/reference'

type ApprovalBatchRequiredEvent = Extract<AiRunEvent, { type: 'approval_batch_required' }>
type ApprovalBatchDecisionAction = 'approve' | 'reject' | 'guide'

type ApplyForceConfirmState = {
  changeId: string
  title: string
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

const clampWorkbenchSidebarWidth = (width: number): number =>
  Math.max(WORKBENCH_SIDEBAR_MIN_WIDTH, Math.min(WORKBENCH_SIDEBAR_MAX_WIDTH, width))

const createEmptyPanel = (): WorkbenchContentPanelState => ({
  kind: 'empty',
  title: '',
  description: ''
})

const createAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  messageId,
  status: 'running',
  processThoughts: [],
  processGroups: [createAssistantThinkingGroup(messageId)],
  finalAnswerMarkdown: '',
  artifacts: [],
  applyTargets: [],
  blockers: []
})

const createSearchAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  messageId,
  status: 'running',
  processThoughts: [],
  processGroups: [createSearchProcessGroup(messageId)],
  finalAnswerMarkdown: '',
  artifacts: [],
  applyTargets: [],
  blockers: []
})

const artifactToApplyTarget = (
  artifact: AiArtifactRef
): AssistantTurnViewModel['applyTargets'][number] | null => {
  if (artifact.kind !== 'file' || !artifact.applyId) return null
  return {
    changeId: artifact.applyId,
    title: artifact.fileName,
    sourcePath: artifact.path,
    changeCount: 0,
    status: 'applied'
  }
}

const buildAssistantTurnFromMessage = (message: ChatMessage): AssistantTurnViewModel | null => {
  if (message.role !== 'assistant') return null
  const artifacts = message.artifacts || []
  return {
    messageId: message.id,
    status: message.error ? 'failed' : 'completed',
    processThoughts: [],
    processGroups: [],
    finalAnswerMarkdown: message.content,
    artifacts: artifacts.map((artifact) => ({
      path: artifact.path,
      fileName: artifact.fileName,
      origin: 'artifact',
      summary: artifact.summary,
      applyId: artifact.applyId,
      operation: artifact.operation,
      format: artifact.capability === 'docx' ? 'docx' : undefined
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

  if (event.type === 'file_artifact') {
    next = {
      ...next,
      artifacts: dedupeFileRefs([
        ...next.artifacts,
        {
          path: event.path,
          fileName: event.fileName,
          origin: 'artifact',
          summary: event.summary,
          applyId: event.applyId,
          operation: event.operation,
          format: event.capability === 'docx' ? 'docx' : undefined
        }
      ]),
      applyTargets: event.applyId
        ? mergeApplyTargets(next.applyTargets, {
            changeId: event.applyId,
            title: event.fileName,
            sourcePath: event.path,
            changeCount: 0,
            status: 'applied'
          })
        : next.applyTargets
    }
  }

  if (event.type === 'workspace_required' && !event.internal) {
    next = { ...next, status: 'failed', error: event.reason }
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
      status: 'completed',
      processGroups: completeAssistantProcessGroups(next.processGroups)
    }
  }

  if (event.type === 'run_failed') {
    next = { ...next, status: 'failed', error: event.error }
  }

  if (event.type === 'run_cancelled') {
    next = { ...next, status: 'failed', error: '已取消' }
  }

  if (event.type === 'run_completed') {
    next = {
      ...next,
      status: next.status === 'failed' ? 'failed' : 'completed'
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
    processGroups:
      run.status === 'completed' || Boolean(getRunMessageContent(run))
        ? completeAssistantProcessGroups(turn.processGroups)
        : turn.processGroups,
    finalAnswerMarkdown: getRunMessageContent(run) || turn.finalAnswerMarkdown,
    artifacts: dedupeFileRefs([
      ...turn.artifacts,
      ...artifacts.map((artifact) => ({
        path: artifact.path,
        fileName: artifact.fileName,
        origin: 'artifact' as const,
        summary: artifact.summary,
        applyId: artifact.applyId,
        operation: artifact.operation,
        format: artifact.capability === 'docx' ? ('docx' as const) : undefined
      }))
    ]),
    applyTargets: artifacts
      .map(artifactToApplyTarget)
      .filter((target): target is AssistantTurnViewModel['applyTargets'][number] => Boolean(target))
      .reduce((items, target) => mergeApplyTargets(items, target), turn.applyTargets),
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
  const base: AssistantTurnViewModel = {
    ...createAssistantTurn(snapshot.run.assistantMessageId),
    runId: snapshot.run.id
  }
  const replayed = snapshot.events.reduce<AssistantTurnViewModel>(
    (turn, event) => reduceAssistantTurnByRunEvent(turn, event),
    base
  )
  return applyRunRecordToTurn(replayed, snapshot.run)
}

const appendArtifactForMessage = (
  store: Record<string, AiArtifactRef[]>,
  messageId: string,
  artifact: AiArtifactRef
): void => {
  const currentArtifacts = store[messageId] || []
  const exists = currentArtifacts.some(
    (item) =>
      item.path === artifact.path &&
      item.applyId === artifact.applyId &&
      item.summary === artifact.summary
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

const fileChangeToDocxApplyRecord = (record: AiFileChangeRecord): DocxApplyRecord => ({
  id: record.id,
  session_id: record.sessionId,
  run_id: record.runId,
  status: record.status,
  source_path: record.path,
  source_name: record.fileName,
  operation: record.operation,
  final_revision_ref: '',
  change_count: record.changeCount,
  before_exists: Boolean(record.beforeSnapshotPath),
  before_snapshot_path: record.beforeSnapshotPath,
  before_checksum: record.beforeChecksum,
  preview_diff_artifact_path: record.previewPath || record.path,
  preview_diff_checksum: '',
  preview_diff_byte_size: 0,
  after_checksum: record.afterChecksum,
  created_at: record.createdAt,
  updated_at: record.updatedAt,
  reverted_at: record.revertedAt,
  error: record.error
})

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
  workspace ? '当前工作区未设置文件目录，请前往 设置 > 工作空间 绑定地址' : '请先选择工作区'

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

const ChatPage: React.FC = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [deleteConfirmSession, setDeleteConfirmSession] = useState<ChatSession | null>(null)
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set())
  const [composerMode, setComposerMode] = useState<WorkbenchMode>(() =>
    readWorkbenchModePreference(window.localStorage)
  )
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiRunId, setAiRunId] = useState<string | null>(null)
  const [cancellingRun, setCancellingRun] = useState(false)
  const [composerContentNodes, setComposerContentNodes] = useState<ChatMessageContentNode[]>([])
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSource[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() =>
    readWorkbenchWorkspacePreference(window.localStorage)
  )
  const [workspaceDocumentIds, setWorkspaceDocumentIds] = useState<string[]>([])
  const [activeModelConfig, setActiveModelConfig] = useState<LLMConfig | null>(null)
  const [remoteModels, setRemoteModels] = useState<LlmRemoteModel[]>([])
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null)
  const [composerResetKey, setComposerResetKey] = useState(0)
  const [contextUsage, setContextUsage] = useState<WorkbenchContextUsage | null>(null)
  const [assistantTurns, setAssistantTurns] = useState<Record<string, AssistantTurnViewModel>>({})
  const [contentPanel, setContentPanel] = useState<WorkbenchContentPanelState>(createEmptyPanel())
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_STORAGE_KEY)
    return stored === 'true'
  })
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY)
    return clampWorkbenchSidebarWidth(stored ? Number(stored) : WORKBENCH_SIDEBAR_DEFAULT_WIDTH)
  })
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Set<string>>(() => new Set())
  const [contentPanelCollapsed, setContentPanelCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  })

  const [activeApplyRecord, setActiveApplyRecord] = useState<DocxApplyRecord | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyReverting, setApplyReverting] = useState(false)
  const [applyForceConfirm, setApplyForceConfirm] = useState<ApplyForceConfirmState | null>(null)

  const [pendingApprovalBatch, setPendingApprovalBatch] =
    useState<ApprovalBatchRequiredEvent | null>(null)
  const [approvalCurrentIndex, setApprovalCurrentIndex] = useState(0)
  const [approvalDraftDecisions, setApprovalDraftDecisions] = useState<
    Record<string, ApprovalDraftDecision>
  >({})
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)

  const activeRunMessageIdsRef = useRef<Record<string, string>>({})
  const assistantArtifactsRef = useRef<Record<string, AiArtifactRef[]>>({})
  const lastSubmittedInputRef = useRef('')
  const sidebarDragStartRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const sidebarResizeFrameRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)

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

  const currentApprovalItem = useMemo(() => {
    if (!pendingApprovalBatch) return null
    return pendingApprovalBatch.items[approvalCurrentIndex] || pendingApprovalBatch.items[0] || null
  }, [approvalCurrentIndex, pendingApprovalBatch])
  const selectedWorkspaceReady = useMemo(
    () => hasWorkspaceRootPath(selectedWorkspace),
    [selectedWorkspace]
  )
  const composerSubmitDisabledReason = useMemo(() => {
    if (!input.trim()) return '输入内容后再发送'
    if (!currentSessionId) return '当前会话未就绪'
    if (!selectedWorkspaceReady)
      return `${getWorkspaceRequirementHint(selectedWorkspace)}后再发送消息`
    if (composerMode === 'ai' && !selectedModelName) return '请先选择可用模型'
    return null
  }, [
    composerMode,
    currentSessionId,
    input,
    selectedModelName,
    selectedWorkspace,
    selectedWorkspaceReady
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

  const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const scrollElement = event.currentTarget
    const distanceToBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
    shouldAutoScrollRef.current = distanceToBottom <= SCROLL_BOTTOM_TOLERANCE
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
      if (typeof message.error === 'function') {
        message.error(content)
        return
      }
      if (typeof message.open === 'function') {
        message.open({ type: 'error', content })
      }
    },
    [message]
  )

  const showContentPanel = useCallback((nextState: WorkbenchContentPanelState): void => {
    setContentPanel(nextState)
    setContentPanelCollapsed(false)
  }, [])

  const showApplyWorkspace = useCallback(
    (applyId: string | null): void => {
      showContentPanel({
        kind: 'apply_workspace',
        title: '修改的文件',
        applyId
      })
    },
    [showContentPanel]
  )

  const resetApplyWorkspaceState = (): void => {
    setActiveApplyRecord(null)
    setApplyLoading(false)
    setApplyReverting(false)
    setApplyForceConfirm(null)
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

  const openPathOrNotify = async (filePath: string): Promise<void> => {
    const result = await window.api.openPath(filePath)
    if (!result.success) emitErrorMessage(result.error || '打开失败')
  }

  const revealPathOrNotify = async (filePath: string): Promise<void> => {
    const result = await window.api.revealPath(filePath)
    if (!result.success) emitErrorMessage(result.error || '定位失败')
  }

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.chatSessionList()
      setSessions(list)
      if (list.length > 0) {
        setCurrentSessionId((current) => current || list[0].id)
      }
    } catch (error) {
      console.error('Failed to load sessions', error)
    }
  }, [])

  const loadSessionSnapshot = async (sessionId: string): Promise<void> => {
    try {
      const snapshot = await window.api.chatSessionSnapshotGet({ sessionId })
      setCurrentMessages(snapshot.messages)
      assistantArtifactsRef.current = {}
      activeRunMessageIdsRef.current = {}
      setAssistantTurns(() => {
        const nextTurns: Record<string, AssistantTurnViewModel> = {}
        for (const message of snapshot.messages) {
          if (message.artifacts && message.artifacts.length > 0) {
            assistantArtifactsRef.current[message.id] = message.artifacts
          }
          const turn = buildAssistantTurnFromMessage(message)
          if (turn) nextTurns[message.id] = turn
        }
        const runSnapshots = snapshot.runs || snapshot.activeRuns
        const activeRunIds = new Set(snapshot.activeRuns.map((item) => item.run.id))
        for (const runSnapshot of runSnapshots) {
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
        snapshot.activeRuns.find((item) => item.run.status === 'running') || snapshot.activeRuns[0]
      setAiRunId(visibleActiveRun?.run.id || null)
      setLoading(Boolean(visibleActiveRun && visibleActiveRun.run.status === 'running'))
      const approval =
        snapshot.activeRuns.find((item) => item.pendingApproval && !item.pendingApproval.internal)
          ?.pendingApproval || null
      setPendingApprovalBatch(approval)
      setApprovalCurrentIndex(0)
      setApprovalDraftDecisions({})
      setApprovalSubmitting(false)
      shouldAutoScrollRef.current = true
      scrollToBottom(true)
    } catch (error) {
      console.error('Failed to load session snapshot', error)
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
      const nextWorkspaceId = resolveWorkbenchWorkspaceSelection(
        response.items,
        readWorkbenchWorkspacePreference(window.localStorage)
      )
      setSelectedWorkspaceId(nextWorkspaceId)
      writeWorkbenchWorkspacePreference(window.localStorage, nextWorkspaceId)
    } catch (error) {
      console.error('Failed to load workspaces', error)
    }
  }, [])

  const loadModelConfigs = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.llmConfigList()
      const activeConfig = list.find((config) => config.is_active) || list[0] || null
      setActiveModelConfig(activeConfig)
      if (!activeConfig) {
        setRemoteModels([])
        setSelectedModelName(null)
        return
      }
      const fallbackModelName = activeConfig.default_model?.trim() || null
      const fallbackModels: LlmRemoteModel[] = fallbackModelName
        ? [{ id: fallbackModelName, label: fallbackModelName }]
        : []
      setRemoteModels(fallbackModels)
      setSelectedModelName(fallbackModelName)
      const response = await window.api.llmConfigModelList(activeConfig.id)
      const items = response.success && response.items.length > 0 ? response.items : fallbackModels
      setRemoteModels(items)
      const nextModelName = resolveWorkbenchModelSelection({
        configId: activeConfig.id,
        models: items,
        defaultModelName: activeConfig.default_model,
        preference: readWorkbenchModelPreference(window.localStorage)
      })
      setSelectedModelName(nextModelName)
      writeWorkbenchModelPreference(
        window.localStorage,
        nextModelName
          ? {
              configId: activeConfig.id,
              modelName: nextModelName
            }
          : null
      )
    } catch (error) {
      console.error('Failed to load llm configs', error)
      setActiveModelConfig(null)
      setRemoteModels([])
      setSelectedModelName(null)
    }
  }, [])

  const handleModelNameChange = useCallback(
    (modelName: string): void => {
      setSelectedModelName(modelName)
      writeWorkbenchModelPreference(
        window.localStorage,
        activeModelConfig
          ? {
              configId: activeModelConfig.id,
              modelName
            }
          : null
      )
      if (!activeModelConfig || activeModelConfig.default_model === modelName) return

      const nextConfig: LLMConfig = {
        ...activeModelConfig,
        default_model: modelName
      }
      setActiveModelConfig(nextConfig)
      void window.api.llmConfigSave(nextConfig).then((response) => {
        if (!response.success) {
          emitErrorMessage(response.error || '默认模型保存失败')
          return
        }
        window.dispatchEvent(new Event('check-llm-config'))
      })
    },
    [activeModelConfig, emitErrorMessage]
  )

  const handleModeChange = useCallback((mode: WorkbenchMode): void => {
    setComposerMode(mode)
    writeWorkbenchModePreference(window.localStorage, mode)
  }, [])

  const handleWorkspaceChange = useCallback((workspaceId: string | null): void => {
    setSelectedWorkspaceId(workspaceId)
    writeWorkbenchWorkspacePreference(window.localStorage, workspaceId)
  }, [])

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

  const handleNewSessionWorkspaceChange = useCallback(
    (workspaceId: string): void => {
      handleWorkspaceChange(workspaceId)
      if (!currentSession || currentMessages.length > 0) return
      const nextSession = { ...currentSession, workspace_id: workspaceId }
      setSessions((items) => items.map((item) => (item.id === nextSession.id ? nextSession : item)))
      void window.api.chatSessionSave(nextSession).catch(console.error)
    },
    [currentMessages.length, currentSession, handleWorkspaceChange]
  )

  const createNewSession = useCallback(
    async (workspaceId?: string): Promise<void> => {
      try {
        const timestamp = Date.now()
        const targetWorkspaceId =
          workspaceId ||
          currentSession?.workspace_id ||
          selectedWorkspaceId ||
          (workspaces.length > 0 ? workspaces[0].id : '')

        if (!targetWorkspaceId) {
          message.warning('请先在设置中创建工作空间')
          return
        }

        const nextSession: ChatSession = {
          id: crypto.randomUUID(),
          title: '新对话',
          created_at: timestamp,
          workspace_id: targetWorkspaceId
        }
        await window.api.chatSessionSave(nextSession)
        await loadSessions()
        setCurrentSessionId(nextSession.id)
        if (targetWorkspaceId !== selectedWorkspaceId) {
          setSelectedWorkspaceId(targetWorkspaceId)
          writeWorkbenchWorkspacePreference(window.localStorage, targetWorkspaceId)
        }
      } catch (error) {
        console.error(error)
        emitErrorMessage('创建会话失败')
      }
    },
    [
      currentSession?.workspace_id,
      emitErrorMessage,
      loadSessions,
      message,
      selectedWorkspaceId,
      workspaces
    ]
  )

  const selectSession = (session: ChatSession): void => {
    setCurrentSessionId(session.id)
    setSelectedWorkspaceId(session.workspace_id)
    writeWorkbenchWorkspacePreference(window.localStorage, session.workspace_id)
  }

  const loadApplyRecord = async (input: {
    applyId: string
    detail?: DocxApplyRecord | null
    openWorkspace?: boolean
  }): Promise<void> => {
    setApplyLoading(true)
    try {
      let nextRecord = input.detail || null
      if (!nextRecord) {
        const fileChange = await window.api.aiFileChangeGet({ changeId: input.applyId })
        nextRecord = fileChange.record ? fileChangeToDocxApplyRecord(fileChange.record) : null
      }
      if (!nextRecord) {
        const fallback = await window.api.docxApplyGet({ applyId: input.applyId })
        nextRecord = fallback.record || null
      }
      if (!nextRecord) {
        setActiveApplyRecord(null)
        return
      }

      setActiveApplyRecord(nextRecord)

      if (input.openWorkspace) {
        showApplyWorkspace(nextRecord.id)
      }
    } catch (error) {
      console.error('Failed to load apply record', error)
      setActiveApplyRecord(null)
    } finally {
      setApplyLoading(false)
    }
  }

  const loadFileChangesForSession = async (
    sessionId: string,
    options?: {
      preferredApplyId?: string | null
      autoOpen?: boolean
      forceOpenWorkspace?: boolean
      skipApplyRecordReload?: boolean
    }
  ): Promise<void> => {
    try {
      const shouldWaitForRecords =
        Boolean(options?.forceOpenWorkspace) || Boolean(options?.preferredApplyId)
      const maxAttempts = shouldWaitForRecords ? 6 : 1
      let allRecords: AiFileChangeRecord[] = []
      let activeRecords: AiFileChangeRecord[] = []

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await window.api.aiFileChangeList({ sessionId })
        const nextItems = sortFileChangeRecords(response.items)
        allRecords = nextItems
        activeRecords = nextItems.filter((item) => ACTIVE_FILE_CHANGE_STATUSES.has(item.status))

        const missingPreferred =
          options?.preferredApplyId !== undefined &&
          options.preferredApplyId !== null &&
          !allRecords.some((record) => record.id === options.preferredApplyId)
        if (!missingPreferred) break
        if (attempt < maxAttempts - 1) await delay(150)
      }

      const applyTargetsByRunId = groupApplyTargetsByRunId(allRecords)

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
          setContentPanelCollapsed(true)
        }
        return
      }

      const previewFileKey = contentPanel.kind === 'file_preview' ? contentPanel.file.path : null
      if (options?.skipApplyRecordReload) {
        setActiveApplyRecord(fileChangeToDocxApplyRecord(nextSelectedRecord))
        if (options.forceOpenWorkspace || contentPanel.kind === 'apply_workspace') {
          showApplyWorkspace(nextSelectedRecord.id)
        }
        return
      }

      const shouldOpenWorkspace =
        Boolean(options?.forceOpenWorkspace) ||
        contentPanel.kind === 'apply_workspace' ||
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
    }
  }

  useEffect(() => {
    void loadSessions()
    void loadWorkspaces()
    void loadModelConfigs()
  }, [loadSessions, loadModelConfigs, loadWorkspaces])

  useEffect(() => {
    const handleModelRefresh = (): void => {
      void loadModelConfigs()
    }
    window.addEventListener('check-llm-config', handleModelRefresh)
    return () => {
      window.removeEventListener('check-llm-config', handleModelRefresh)
    }
  }, [loadModelConfigs])

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
    window.localStorage.setItem(
      WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY,
      String(contentPanelCollapsed)
    )
  }, [contentPanelCollapsed])

  useEffect(() => {
    if (sessions.length === 0 && workspaces.length > 0 && !currentSessionId) {
      void createNewSession(workspaces[0].id)
    }
  }, [sessions.length, workspaces, currentSessionId, createNewSession])

  useEffect(() => {
    if (currentSessionId) {
      let cancelled = false
      const sessionId = currentSessionId
      const sessionWorkspaceId = currentSession?.workspace_id || null
      if (sessionWorkspaceId && sessionWorkspaceId !== selectedWorkspaceId) {
        setSelectedWorkspaceId(sessionWorkspaceId)
        writeWorkbenchWorkspacePreference(window.localStorage, sessionWorkspaceId)
      }
      setLoading(false)
      setAiRunId(null)
      setCancellingRun(false)
      setInput('')
      setComposerContentNodes([])
      setSelectedReferences([])
      setComposerResetKey((value) => value + 1)
      setPendingApprovalBatch(null)
      setApprovalCurrentIndex(0)
      setApprovalDraftDecisions({})
      setApprovalSubmitting(false)
      void loadSessionSnapshot(sessionId).then(() => {
        if (cancelled) return
        setContentPanel(createEmptyPanel())
        setContentPanelCollapsed(true)
        resetApplyWorkspaceState()
      })
      void loadFileChangesForSession(sessionId)
      void refreshContextUsage(sessionId)
      return () => {
        cancelled = true
      }
    } else {
      setCurrentMessages([])
      setAssistantTurns({})
      setContextUsage(null)
      setContentPanel(createEmptyPanel())
      setContentPanelCollapsed(true)
      resetApplyWorkspaceState()
    }
    return undefined
    // Session switch reset must run only when the selected session id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, refreshContextUsage])

  useEffect(() => {
    scrollToBottom()
  }, [assistantTurns, currentMessages, loading, pendingApprovalBatch])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    []
  )

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('workbench-mode-change', { detail: { mode: composerMode } })
    )
  }, [composerMode])

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
      setSessions(remainingSessions)
      setCurrentSessionId((current) =>
        current === id ? remainingSessions[0]?.id || null : current
      )
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

  const openFile = async (
    file: WorkbenchFileRef,
    backTarget?: WorkbenchContentPanelState
  ): Promise<void> => {
    showContentPanel({
      kind: 'file_preview',
      title: '文档查看',
      file,
      backTarget
    })
  }

  const resolveReferencePathInfo = async (filePath: string): Promise<boolean> => {
    const response = await window.api.pathInfo(filePath)
    return Boolean(response.success && response.isDirectory)
  }

  const openMarkdownReference = async (reference: {
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
      origin: reference.kind === 'reference' ? 'source' : 'read',
      isDirectory: await resolveReferencePathInfo(reference.path)
    })
  }

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

  const openFileChange = (changeId: string): void => {
    if (currentSessionId) {
      void loadFileChangesForSession(currentSessionId, {
        preferredApplyId: changeId,
        forceOpenWorkspace: true
      })
      return
    }

    void loadApplyRecord({
      applyId: changeId,
      openWorkspace: true
    })
  }

  useEffect(() => {
    const unsubscribe = window.api.onAiRunEvent((event) => {
      const messageId = activeRunMessageIdsRef.current[event.runId]
      if (!messageId) {
        if (event.type === 'run_started' && event.sessionId === currentSessionId) {
          void loadSessionSnapshot(currentSessionId)
        }
        return
      }

      if (event.type === 'run_started') {
        setAiRunId(event.runId)
      }

      updateTurnForRun(event.runId, (current) => reduceAssistantTurnByRunEvent(current, event))

      if (event.type === 'tool_call_result') {
        const toolOutput = event.result?.data ?? null
        const searchResults = extractSearchResultsFromToolOutput(toolOutput)
        if (searchResults.length > 0) {
          showContentPanel({
            kind: 'search_list',
            title: '搜索结果',
            query: lastSubmittedInputRef.current || event.toolName,
            results: searchResults,
            tokens: []
          })
        }
        return
      }

      if (event.type === 'browser_panel_opened') {
        showContentPanel({
          kind: 'browser',
          title: '内置浏览器'
        })
        return
      }

      if (event.type === 'file_artifact') {
        appendArtifactForMessage(assistantArtifactsRef.current, messageId, {
          kind: 'file',
          capability: event.capability,
          path: event.path,
          fileName: event.fileName,
          operation: event.operation,
          applyId: event.applyId,
          summary: event.summary
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

      if (event.type === 'workspace_required') {
        if (!event.internal) {
          setLoading(false)
          message.warning(event.reason || '当前工作区未设置文件目录，请先完成绑定后再发送')
        }
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
          message.warning('审核结果已提交，等待馆长继续决策')
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
                  content: `${item.content || ''}\n\n**[失败]** ${event.error}`
                }
              : item
          )
        )
        emitErrorMessage(event.error || '运行失败')
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
                  content: item.content ? `${item.content}\n\n**[已取消]**` : '**[已取消]**'
                }
              : item
          )
        )
        message.info('已取消')
        return
      }

      if (event.type === 'run_completed') {
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        if (currentSessionId) {
          void loadFileChangesForSession(currentSessionId, { autoOpen: true })
        }
        void refreshContextUsage(currentSessionId)
      }
    })
    return () => {
      unsubscribe()
    }
    // AI run listener is intentionally keyed by active run/session identity to avoid resubscribing on UI helper changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, message, refreshContextUsage])

  const handleSend = async (): Promise<void> => {
    if (composerMode === 'ai' && aiRunId) {
      await handleCancel()
      return
    }
    if (composerMode === 'search') {
      await handleSearchSend()
      return
    }
    if (!input.trim() || !currentSessionId || loading) return
    if (!selectedWorkspaceReady) {
      message.warning(`${getWorkspaceRequirementHint(selectedWorkspace)}后再发送消息`)
      return
    }
    if (!selectedModelName) {
      message.warning('当前配置未获取到可用模型，请先在「大模型」中打开模型列表获取模型')
      return
    }

    const userQuery = input.trim()
    const submittedContentNodes = composerContentNodes
    const submittedReferences = selectedReferences
    const optimisticUserMessage: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now(),
      contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
      selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
      error: false
    }
    const optimisticAssistantMessage: ChatMessage = {
      id: `local-assistant-${crypto.randomUUID()}`,
      session_id: currentSessionId,
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

    setInput('')
    setComposerContentNodes([])
    setSelectedReferences([])
    setComposerResetKey((value) => value + 1)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setLoading(true)
    setCancellingRun(false)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)
    lastSubmittedInputRef.current = userQuery
    setCurrentMessages((previous) =>
      appendMessagesDedupe(previous, [optimisticUserMessage, optimisticAssistantMessage])
    )
    setAssistantTurns((previous) => ({
      ...previous,
      [optimisticAssistantMessage.id]: createAssistantTurn(optimisticAssistantMessage.id)
    }))

    try {
      const response = await window.api.chatSubmit({
        mode: 'ai',
        sessionId: currentSessionId,
        input: userQuery,
        contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
        selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
        modelName: selectedModelName,
        workspace: createWorkspaceBinding(selectedWorkspace)
      })
      if (
        !response.success ||
        !response.run ||
        !response.userMessage ||
        !response.assistantMessage
      ) {
        setLoading(false)
        setCurrentMessages(removeOptimisticMessages)
        setAssistantTurns(removeOptimisticAssistantTurn)
        emitErrorMessage(response.error || '启动失败')
        return
      }
      const run = response.run
      const assistantMessageId = response.assistantMessage.id
      activeRunMessageIdsRef.current[run.id] = assistantMessageId
      assistantArtifactsRef.current[assistantMessageId] = []
      setCurrentMessages((previous) =>
        appendMessagesDedupe(removeOptimisticMessages(previous), [
          response.userMessage,
          response.assistantMessage
        ])
      )
      setAiRunId(run.id)
      setAssistantTurns((previous) => {
        const next = removeOptimisticAssistantTurn(previous)
        return {
          ...next,
          [assistantMessageId]: {
            ...(previous[assistantMessageId] || createAssistantTurn(assistantMessageId)),
            runId: run.id
          }
        }
      })
      void loadSessions()
    } catch (error) {
      console.error(error)
      setLoading(false)
      setCurrentMessages(removeOptimisticMessages)
      setAssistantTurns(removeOptimisticAssistantTurn)
      emitErrorMessage('发送失败')
    }
  }

  const handleSearchSend = async (): Promise<void> => {
    if (!input.trim() || !currentSessionId || loading) return
    if (!selectedWorkspaceReady) {
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

    setInput('')
    setComposerContentNodes([])
    setSelectedReferences([])
    setComposerResetKey((value) => value + 1)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setLoading(true)
    setCancellingRun(false)
    setAiRunId(null)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)

    try {
      const response = await window.api.chatSubmit({
        mode: 'search',
        sessionId: currentSessionId,
        input: userQuery,
        contentNodes: submittedContentNodes.length > 0 ? submittedContentNodes : undefined,
        selectedReferences: submittedReferences.length > 0 ? submittedReferences : undefined,
        workspace: createWorkspaceBinding(selectedWorkspace),
        searchDocumentIds: hasStrictScope ? kbScopeDocumentIds : undefined
      })
      if (!response.success || !response.userMessage || !response.assistantMessage) {
        emitErrorMessage(response.error || '搜索失败')
        return
      }
      const results = response.results || []
      const assistantContent = response.content || response.assistantMessage.content
      const completedAssistantMessageId = response.assistantMessage.id
      setCurrentMessages((previous) =>
        appendMessagesDedupe(previous, [response.userMessage, response.assistantMessage])
      )
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
    setApplyReverting(true)
    try {
      const response = await window.api.aiFileChangeRevert({
        changeId: activeApplyRecord.id,
        force: false
      })
      if (response.requiresForce) {
        setApplyForceConfirm({
          changeId: activeApplyRecord.id,
          title: '恢复到本次修改前？',
          content:
            response.warning ||
            '当前文件在这次 AI 修改后又发生了变化。继续操作会恢复到这次修改前的版本，并丢失之后的修改。'
        })
        return
      }
      if (!response.success) {
        emitErrorMessage(response.error || '回退失败')
        return
      }
      if (response.record) {
        setActiveApplyRecord(fileChangeToDocxApplyRecord(response.record))
        showApplyWorkspace(response.record.id)
      }
      emitSuccessMessage('已回退本次修改')
      await loadFileChangesForSession(currentSessionId, {
        preferredApplyId: response.record?.id || activeApplyRecord.id,
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

  const handleForceApplyRevertConfirm = async (): Promise<void> => {
    if (!applyForceConfirm || !currentSessionId) return
    setApplyReverting(true)
    try {
      const forced = await window.api.aiFileChangeRevert({
        changeId: applyForceConfirm.changeId,
        force: true
      })
      if (!forced.success) {
        emitErrorMessage(forced.error || '回退失败')
        return
      }
      if (forced.record) {
        setActiveApplyRecord(fileChangeToDocxApplyRecord(forced.record))
        showApplyWorkspace(forced.record.id)
      }
      setApplyForceConfirm(null)
      emitSuccessMessage('已回退本次修改')
      await loadFileChangesForSession(currentSessionId, {
        preferredApplyId: forced.record?.id || applyForceConfirm.changeId,
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

  const renderUserMessage = (messageItem: ChatMessage): React.ReactNode => {
    const contentNodes: ChatMessageContentNode[] =
      messageItem.contentNodes && messageItem.contentNodes.length > 0
        ? messageItem.contentNodes
        : [
            ...(messageItem.selectedReferences || []).map(
              (reference): ChatMessageContentNode => ({ kind: 'reference', reference })
            ),
            ...(messageItem.content ? [{ kind: 'text' as const, text: messageItem.content }] : [])
          ]
    return (
      <div key={messageItem.id} className="flex justify-end">
        <div className="min-w-0 max-w-[66%]">
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
              onOpenReference={(reference) => {
                void openMarkdownReference(reference)
              }}
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
        onOpenFile={(file) => {
          void openFile(file)
        }}
        onOpenApply={openFileChange}
        workspaces={workspaces}
        fallbackWorkspaceName={selectedWorkspace?.name || null}
        onOpenReference={(reference) => {
          void openMarkdownReference(reference)
        }}
      />
    )
  }

  const handleComposerDraftChange = useCallback(
    (draft: {
      input: string
      contentNodes: ChatMessageContentNode[]
      selectedReferences: SelectedReference[]
    }) => {
      setInput(draft.input)
      setComposerContentNodes(draft.contentNodes)
      setSelectedReferences(draft.selectedReferences)
    },
    []
  )

  // 按工作空间分组会话
  const sessionsByWorkspace = useMemo(() => {
    const groups = new Map<string, ChatSession[]>()
    sessions.forEach((session) => {
      const wsId = session.workspace_id || ''
      if (!groups.has(wsId)) {
        groups.set(wsId, [])
      }
      groups.get(wsId)!.push(session)
    })
    return groups
  }, [sessions])

  // 判断是否为新会话（没有消息）
  const isNewSession = useMemo(() => currentMessages.length === 0, [currentMessages])

  // 获取平台信息
  const [platform, setPlatform] = useState<string>('darwin')
  useEffect(() => {
    setPlatform(navigator.platform.toLowerCase().includes('win') ? 'win32' : 'darwin')
  }, [])

  return (
    <div
      className={`nc-app-shell ${platform === 'win32' ? 'nc-app-shell-windows' : ''}`}
      data-testid={workbenchSelectors.page}
      data-workbench-mode={composerMode}
    >
      {platform === 'win32' ? <WindowsTitleBar /> : null}
      {platform !== 'win32' ? (
        <div
          className="nc-left-titlebar-chrome"
          style={{
            width: sidebarCollapsed ? WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH : sidebarWidth
          }}
        >
          <div className="nc-left-titlebar-window-controls" aria-hidden="true" />
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
      ) : null}
      <aside
        className={`nc-sidebar ${platform === 'darwin' ? 'nc-sidebar-mac' : ''} ${
          sidebarCollapsed ? 'nc-sidebar-hidden' : ''
        }`}
        style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
        data-testid={workbenchSelectors.sidebar}
      >
        <div
          className={`nc-sidebar-window-spacer ${platform === 'darwin' ? 'nc-sidebar-window-spacer-mac' : ''}`}
          aria-hidden="true"
        />

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
        </div>

        <div
          className="flex-1 overflow-y-auto px-2 py-2"
          data-testid={workbenchSelectors.sessionsList}
        >
          {workspaces.map((workspace) => {
            const workspaceSessions = sessionsByWorkspace.get(workspace.id) || []
            const workspaceCollapsed = collapsedWorkspaceIds.has(workspace.id)
            return (
              <div key={workspace.id} className="nc-sidebar-workspace-group">
                <div className="nc-sidebar-workspace-header group">
                  <div className="flex min-w-0 items-center gap-2">
                    <HiFolder className="h-4 w-4 shrink-0 text-[#91918E]" />
                    <span className="truncate">{workspace.name}</span>
                    <button
                      type="button"
                      className="nc-sidebar-workspace-collapse workbench-no-drag relative z-10 cursor-pointer"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => toggleWorkspaceCollapsed(workspace.id)}
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
                  <div className="mt-1 space-y-1">
                    {workspaceSessions.map((session) => (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        data-testid={`${workbenchSelectors.sessionItemPrefix}-${session.id}`}
                        className={`nc-sidebar-item group relative ${
                          currentSessionId === session.id
                            ? 'nc-sidebar-item-active'
                            : 'bg-transparent'
                        } ${deletingSessionIds.has(session.id) ? 'pointer-events-none opacity-60' : ''} px-3 py-2`}
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
                          <div className="flex shrink-0 items-center gap-1 text-[11px] text-[#91918E] group-hover:hidden">
                            <HiClock className="h-3 w-3" />
                            <span>{formatRelativeTime(session.created_at)}</span>
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
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-2 py-2">
          <button
            type="button"
            onClick={() => navigate('/settings/model')}
            className="nc-sidebar-nav-row"
            aria-label="设置"
          >
            <HiOutlineCog6Tooth className="h-[18px] w-[18px] shrink-0 text-[#787774]" />
            <span>设置</span>
          </button>
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
          </div>
        ) : null}
        <div className="flex h-full min-h-0 flex-col">
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

              <Button
                type="text"
                size="small"
                icon={
                  <SidebarPanelIcon
                    className="h-4 w-4"
                    variant={contentPanelCollapsed ? 'expand' : 'collapse'}
                  />
                }
                className="workbench-no-drag !flex !h-7 !w-7 !items-center !justify-center !rounded-[6px] !border-0 !bg-transparent !p-0 !shadow-none !text-[#91918E] hover:!bg-transparent hover:!text-[#37352F]"
                style={WORKBENCH_NO_DRAG_REGION_STYLE}
                onClick={() => setContentPanelCollapsed((previous) => !previous)}
                data-testid={workbenchSelectors.contentPanelToggle}
                aria-label={contentPanelCollapsed ? '展开右侧栏' : '收起右侧栏'}
              />
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1">
              <div className="flex h-full min-h-0 flex-col">
                <div
                  className={`nc-document-scroll ${isNewSession ? '!hidden' : ''}`}
                  ref={scrollRef}
                  onScroll={handleMessageScroll}
                >
                  <div className="nc-document">
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
                                    approvalCurrentIndex >= pendingApprovalBatch.items.length - 1 ||
                                    approvalSubmitting
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
                              当前运行需要你授权本地操作。
                            </p>
                            <code className="mx-5 mt-3 block max-h-[min(34vh,320px)] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[#EEEEEC] bg-[#F4F4F2] px-3.5 py-3 font-mono text-[13px] leading-6 text-[#2F3437] [overflow-wrap:anywhere]">
                              {currentApprovalItem.command}
                            </code>
                            <div className="mx-2 mt-3 space-y-1">
                              <button
                                type="button"
                                className="grid min-h-11 w-full grid-cols-[28px_1fr_auto] items-center rounded-[6px] px-3 text-left text-[13px] text-[#37352F] shadow-[inset_3px_0_0_#37352F,inset_0_0_0_1px_#EEEEEC] hover:bg-[#F4F4F2]"
                                onClick={() =>
                                  void handleApprovalDecision({
                                    itemId: currentApprovalItem.itemId,
                                    action: 'approve'
                                  })
                                }
                                disabled={approvalSubmitting}
                                data-testid={chatSelectors.approvalBatchApproveButton}
                              >
                                <span className="text-[#9B9A97]">1.</span>
                                <span>允许本次操作</span>
                                <HiCheck className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className="grid min-h-11 w-full grid-cols-[28px_1fr_auto] items-center rounded-[6px] px-3 text-left text-[13px] text-[#787774] hover:bg-[#F4F4F2]"
                                onClick={() =>
                                  void handleApprovalDecision({
                                    itemId: currentApprovalItem.itemId,
                                    action: 'reject'
                                  })
                                }
                                disabled={approvalSubmitting}
                                data-testid={chatSelectors.approvalBatchDenyButton}
                              >
                                <span className="text-[#9B9A97]">2.</span>
                                <span>拒绝本次操作</span>
                                <HiXMark className="h-4 w-4 text-[#B3261E]" />
                              </button>
                            </div>
                            <div className="mt-3 flex items-center gap-2 border-t border-[#EEEEEC] px-4 py-4">
                              <input
                                className="min-w-0 flex-1 rounded-[6px] border border-[#EEEEEC] bg-[#FFFFFF] px-3 py-2 text-sm text-[#37352F] outline-none placeholder:text-[#9B9A97] focus:border-[#37352F] focus:ring-2 focus:ring-[#EFEFED]"
                                placeholder="告诉馆长该怎么做"
                                value={
                                  approvalDraftDecisions[currentApprovalItem.itemId]?.message || ''
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
                        activeModelConfig={activeModelConfig}
                        remoteModels={remoteModels}
                        selectedModelName={selectedModelName}
                        onModelNameChange={handleModelNameChange}
                        workspaces={workspaces}
                        selectedWorkspaceId={selectedWorkspaceId}
                        onWorkspaceChange={
                          isNewSession ? handleNewSessionWorkspaceChange : handleWorkspaceChange
                        }
                        onWorkspaceEmptyAction={() => navigate('/settings/workspace')}
                        showWorkspaceSelector={isNewSession}
                        onDraftChange={handleComposerDraftChange}
                        onSubmit={() => void handleSend()}
                        onCancel={() => void handleCancel()}
                        loading={loading}
                        cancelling={cancellingRun}
                        canSubmit={Boolean(
                          input.trim() &&
                          currentSessionId &&
                          selectedWorkspaceReady &&
                          (composerMode === 'search' || selectedModelName)
                        )}
                        submitDisabledReason={composerSubmitDisabledReason}
                        showCancel={composerMode === 'ai' && Boolean(aiRunId)}
                        resetKey={composerResetKey}
                        contextUsage={contextUsage}
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

            <div
              className="min-h-0 overflow-hidden transition-[width] duration-200"
              data-testid={workbenchSelectors.contentPanelShell}
              style={{
                width: contentPanelCollapsed
                  ? 0
                  : contentPanel.kind === 'browser'
                    ? 'min(52vw, 860px)'
                    : contentPanel.kind === 'file_preview' ||
                        contentPanel.kind === 'apply_workspace'
                      ? 'min(46vw, 740px)'
                      : 440
              }}
            >
              <WorkbenchContentPanel
                state={contentPanel}
                activeApplyRecord={activeApplyRecord}
                applyLoading={applyLoading}
                applyReverting={applyReverting}
                workspaces={workspaces}
                fallbackWorkspaceName={selectedWorkspace?.name || null}
                onOpenSearchResult={(turn, resultIndex) => void openSearchResult(turn, resultIndex)}
                onRevertApply={() => void handleApplyRevert()}
                onBackToPanelState={showContentPanel}
                onOpenPath={openPathOrNotify}
                onRevealPath={revealPathOrNotify}
              />
            </div>
          </div>
        </div>
        <Modal
          open={Boolean(applyForceConfirm)}
          title={applyForceConfirm?.title || '恢复到本次修改前？'}
          okText="恢复到此前版本"
          cancelText="取消"
          confirmLoading={applyReverting}
          onOk={() => void handleForceApplyRevertConfirm()}
          onCancel={() => setApplyForceConfirm(null)}
        >
          <p>{applyForceConfirm?.content}</p>
        </Modal>
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
      </div>
    </div>
  )
}

export default ChatPage
