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
  ChatMessage,
  ChatSession,
  DocxApplyRecord,
  LLMConfig,
  LlmRemoteModel,
  SelectedReference,
  WorkspaceSource,
  WorkspaceRuntimeBinding
} from '../../../shared/types'
import { parseIpcResult } from '../utils/serialization'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useNavigate } from 'react-router-dom'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import AssistantTurnCard from '../components/workbench/AssistantTurnCard'
import WorkbenchComposer from '../components/workbench/WorkbenchComposer'
import WorkbenchContentPanel from '../components/workbench/WorkbenchContentPanel'
import ReferenceInlineToken from '../components/workbench/composer/ReferenceInlineToken'
import {
  FILE_CHANGE_STATUS_META,
  FILE_ORIGIN_LABELS,
  WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY,
  WORKBENCH_SIDEBAR_DEFAULT_WIDTH,
  WORKBENCH_SIDEBAR_MAX_WIDTH,
  WORKBENCH_SIDEBAR_MIN_WIDTH,
  WORKBENCH_SIDEBAR_STORAGE_KEY,
  WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY
} from '../components/workbench/constants'
import type {
  AssistantTurnViewModel,
  WorkbenchContextUsage,
  FileChangeWorkspaceTab,
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
const WORKBENCH_TOP_DRAG_ZONE_STYLE = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 52,
  zIndex: 1,
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
const WORKBENCH_COLLAPSED_SIDEBAR_TOGGLE_SAFE_WIDTH = 170
const WORKBENCH_COLLAPSED_TOPBAR_NO_DRAG_ZONE_STYLE = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: WORKBENCH_COLLAPSED_SIDEBAR_TOGGLE_SAFE_WIDTH,
  height: 52,
  zIndex: 3,
  WebkitAppRegion: 'no-drag'
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
    changeCount: 0,
    status: 'applied'
  }
}

const buildAssistantTurnFromMessage = (message: ChatMessage): AssistantTurnViewModel | null => {
  if (message.role !== 'assistant') return null
  const artifacts = message.artifacts || []
  if (artifacts.length === 0) return null
  return {
    messageId: message.id,
    status: 'completed',
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

const ChatPage: React.FC = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [composerMode, setComposerMode] = useState<WorkbenchMode>(() =>
    readWorkbenchModePreference(window.localStorage)
  )
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiRunId, setAiRunId] = useState<string | null>(null)
  const [cancellingRun, setCancellingRun] = useState(false)
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
  const [applyWorkspaceTabs, setApplyWorkspaceTabs] = useState<FileChangeWorkspaceTab[]>([])
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

  const assistantMsgIdRef = useRef<string | null>(null)
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
    (tabs: FileChangeWorkspaceTab[], activeFileKey: string | null): void => {
      showContentPanel({
        kind: 'apply_workspace',
        title: '修改的文件',
        tabs,
        activeFileKey
      })
    },
    [showContentPanel]
  )

  const sharedHeaderMeta = useMemo(() => {
    if (contentPanelCollapsed || contentPanel.kind === 'empty') {
      return null
    }

    if (contentPanel.kind === 'file_preview') {
      return {
        title: contentPanel.file.fileName || contentPanel.title,
        badge: FILE_ORIGIN_LABELS[contentPanel.file.origin],
        badgeClassName: 'border-[#EEEEEC] bg-white text-[#787774]'
      }
    }

    if (contentPanel.kind === 'apply_workspace' && activeApplyRecord) {
      const statusMeta = FILE_CHANGE_STATUS_META[activeApplyRecord.status]
      return {
        title: activeApplyRecord.source_name || contentPanel.title,
        badge: statusMeta.label,
        badgeClassName: statusMeta.className
      }
    }

    return {
      title: contentPanel.title,
      badge: null,
      badgeClassName: ''
    }
  }, [activeApplyRecord, contentPanel, contentPanelCollapsed])

  const resetApplyWorkspaceState = (): void => {
    setActiveApplyRecord(null)
    setApplyLoading(false)
    setApplyReverting(false)
    setApplyForceConfirm(null)
    setApplyWorkspaceTabs([])
  }

  const updateActiveTurn = (
    updater: (current: AssistantTurnViewModel) => AssistantTurnViewModel
  ): void => {
    const messageId = assistantMsgIdRef.current
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

  const loadMessages = async (sessionId: string): Promise<void> => {
    try {
      const messages = await window.api.chatMessageList(sessionId)
      setCurrentMessages(messages)
      assistantArtifactsRef.current = {}
      setAssistantTurns(() => {
        const nextTurns: Record<string, AssistantTurnViewModel> = {}
        for (const message of messages) {
          if (message.artifacts && message.artifacts.length > 0) {
            assistantArtifactsRef.current[message.id] = message.artifacts
          }
          const turn = buildAssistantTurnFromMessage(message)
          if (turn) nextTurns[message.id] = turn
        }
        return nextTurns
      })
      shouldAutoScrollRef.current = true
      scrollToBottom(true)
    } catch (error) {
      console.error('Failed to load messages', error)
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
      const response = await window.api.llmConfigModelList(activeConfig.id)
      const items = response.success ? response.items : []
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
    tabs?: FileChangeWorkspaceTab[]
    activeFileKey?: string | null
    openWorkspace?: boolean
  }): Promise<void> => {
    setApplyLoading(true)
    try {
      const response =
        input.detail !== undefined
          ? { record: input.detail }
          : await window.api.docxApplyGet({ applyId: input.applyId })
      let nextRecord = response.record || null
      if (!nextRecord) {
        const fallback = await window.api.aiFileChangeGet({ changeId: input.applyId })
        nextRecord = fallback.record ? fileChangeToDocxApplyRecord(fallback.record) : null
      }
      if (!nextRecord) {
        setActiveApplyRecord(null)
        return
      }

      setActiveApplyRecord(nextRecord)

      if (input.openWorkspace) {
        showApplyWorkspace(
          input.tabs || applyWorkspaceTabs,
          input.activeFileKey || nextRecord.source_path || null
        )
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
      const workspaceRecords = preferredRecord
        ? allRecords.filter((record) => record.runId === preferredRecord.runId)
        : activeRecords

      if (workspaceRecords.length === 0) {
        setApplyWorkspaceTabs([])
        setActiveApplyRecord(null)
        setContentPanel((current) =>
          current.kind === 'apply_workspace' ? createEmptyPanel() : current
        )
        return
      }

      const latestByFileKey = new Map<string, AiFileChangeRecord>()
      workspaceRecords.forEach((record) => {
        const fileKey = record.path
        if (!fileKey || latestByFileKey.has(fileKey)) return
        latestByFileKey.set(fileKey, record)
      })

      const currentWorkspaceFileKey =
        contentPanel.kind === 'apply_workspace'
          ? contentPanel.activeFileKey
          : activeApplyRecord?.source_path || null
      const previewFileKey = contentPanel.kind === 'file_preview' ? contentPanel.file.path : null
      const preferredFileKey = preferredRecord?.path || null
      const nextTabs = [...latestByFileKey.values()].map((record) => {
        const fileKey = record.path || record.id
        const previousTab = applyWorkspaceTabs.find((tab) => tab.fileKey === fileKey)
        const shouldMarkUnseen =
          previousTab?.applyId !== record.id &&
          currentWorkspaceFileKey !== fileKey &&
          previewFileKey !== fileKey &&
          preferredFileKey !== fileKey

        return {
          fileKey,
          applyId: record.id,
          fileName: record.fileName,
          sourcePath: fileKey,
          changeCount: record.changeCount,
          status: record.status,
          unseen: shouldMarkUnseen
        }
      })

      const currentWorkspaceSelectionStillAvailable = Boolean(
        currentWorkspaceFileKey && nextTabs.some((tab) => tab.fileKey === currentWorkspaceFileKey)
      )
      const shouldKeepCurrentWorkspaceSelection =
        contentPanel.kind === 'apply_workspace' &&
        currentWorkspaceSelectionStillAvailable &&
        !options?.forceOpenWorkspace &&
        preferredFileKey !== currentWorkspaceFileKey
      const nextSelectedFileKey =
        (shouldKeepCurrentWorkspaceSelection ? currentWorkspaceFileKey : null) ||
        preferredFileKey ||
        (currentWorkspaceFileKey && nextTabs.some((tab) => tab.fileKey === currentWorkspaceFileKey)
          ? currentWorkspaceFileKey
          : nextTabs[0]?.fileKey || null)
      const normalizedTabs = nextTabs.map((tab) =>
        tab.fileKey === nextSelectedFileKey ? { ...tab, unseen: false } : tab
      )
      setApplyWorkspaceTabs(normalizedTabs)

      const nextSelectedTab =
        normalizedTabs.find((tab) => tab.fileKey === nextSelectedFileKey) || normalizedTabs[0]
      if (!nextSelectedTab) return

      if (options?.skipApplyRecordReload) {
        if (options.forceOpenWorkspace || contentPanel.kind === 'apply_workspace') {
          showApplyWorkspace(normalizedTabs, nextSelectedTab.fileKey)
        }
        return
      }

      const nextSelectedRecord = latestByFileKey.get(nextSelectedTab.fileKey) || null
      if (!nextSelectedRecord) return

      const shouldOpenWorkspace =
        Boolean(options?.forceOpenWorkspace) ||
        contentPanel.kind === 'apply_workspace' ||
        (Boolean(options?.autoOpen) &&
          (contentPanel.kind === 'empty' ||
            (previewFileKey !== null && previewFileKey === nextSelectedTab.fileKey)))

      await loadApplyRecord({
        applyId: nextSelectedTab.applyId,
        tabs: normalizedTabs,
        activeFileKey: nextSelectedTab.fileKey,
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
      const sessionWorkspaceId = currentSession?.workspace_id || null
      if (sessionWorkspaceId && sessionWorkspaceId !== selectedWorkspaceId) {
        setSelectedWorkspaceId(sessionWorkspaceId)
        writeWorkbenchWorkspacePreference(window.localStorage, sessionWorkspaceId)
      }
      void loadMessages(currentSessionId)
      setLoading(false)
      setAiRunId(null)
      setCancellingRun(false)
      setInput('')
      setSelectedReferences([])
      setComposerResetKey((value) => value + 1)
      setPendingApprovalBatch(null)
      setApprovalCurrentIndex(0)
      setApprovalDraftDecisions({})
      setApprovalSubmitting(false)
      setAssistantTurns({})
      setContentPanel(createEmptyPanel())
      resetApplyWorkspaceState()
      void loadFileChangesForSession(currentSessionId, { autoOpen: true })
      void refreshContextUsage(currentSessionId)
    } else {
      setCurrentMessages([])
      setAssistantTurns({})
      setContextUsage(null)
      resetApplyWorkspaceState()
    }
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

  const deleteSession = async (event: React.MouseEvent, id: string): Promise<void> => {
    event.stopPropagation()
    try {
      await window.api.chatSessionDelete(id)
      if (currentSessionId === id) {
        setCurrentSessionId(null)
      }
      await loadSessions()
    } catch (error) {
      console.error(error)
      emitErrorMessage('删除会话失败')
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
      origin: reference.kind === 'reference' ? 'source' : 'read'
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

    const nextTab = applyWorkspaceTabs.find((tab) => tab.applyId === changeId) || null
    const nextTabs = nextTab
      ? applyWorkspaceTabs.map((tab) =>
          tab.fileKey === nextTab.fileKey ? { ...tab, unseen: false } : tab
        )
      : applyWorkspaceTabs
    setApplyWorkspaceTabs(nextTabs)
    void loadApplyRecord({
      applyId: changeId,
      tabs: nextTabs,
      activeFileKey: nextTab?.fileKey || null,
      openWorkspace: true
    })
  }

  useEffect(() => {
    window.api.removeAiRunEventListeners()
    window.api.onAiRunEvent((event) => {
      const hasActiveRun = Boolean(aiRunId)
      const hasPendingAssistantTurn = Boolean(assistantMsgIdRef.current)
      if (hasActiveRun && event.runId !== aiRunId) return
      if (!hasActiveRun && !hasPendingAssistantTurn) return

      if (!hasActiveRun && event.type === 'run_started') {
        setAiRunId(event.runId)
      }

      updateActiveTurn((current) => ({
        ...current,
        processThoughts: reduceAssistantProcessThoughts(current.processThoughts, event),
        processGroups: reduceAssistantProcessGroups(current.processGroups, event)
      }))

      if (event.type === 'tool_call_result') {
        const toolOutput = event.result?.data ?? null
        const readFiles = extractReadableFilesFromToolOutput(
          toolOutput,
          event.toolName.includes('search') ? 'search_hit' : 'read'
        )
        if (readFiles.length > 0) {
          updateActiveTurn((current) => ({
            ...current,
            artifacts: dedupeFileRefs([...current.artifacts, ...readFiles])
          }))
        }

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
        const messageId = assistantMsgIdRef.current
        if (messageId) {
          appendArtifactForMessage(assistantArtifactsRef.current, messageId, {
            kind: 'file',
            capability: event.capability,
            path: event.path,
            fileName: event.fileName,
            operation: event.operation,
            applyId: event.applyId,
            summary: event.summary
          })
        }
        updateActiveTurn((current) => ({
          ...current,
          artifacts: dedupeFileRefs([
            ...current.artifacts,
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
            ? mergeApplyTargets(current.applyTargets, {
                changeId: event.applyId,
                title: event.fileName,
                changeCount: 0,
                status: 'applied'
              })
            : current.applyTargets
        }))
        return
      }

      if (event.type === 'workspace_required') {
        if (!event.internal) {
          setLoading(false)
          message.warning(event.reason || '当前工作区未设置文件目录，请先完成绑定后再发送')
          updateActiveTurn((current) => ({
            ...current,
            status: 'failed',
            error: event.reason
          }))
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
        updateActiveTurn((current) => ({
          ...current,
          status: 'failed',
          error: event.message
        }))
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
        updateActiveTurn((current) => ({
          ...current,
          blockers: [
            {
              kind: 'approval',
              title: '等待批量审核',
              description: `共有 ${event.items.length} 条命令待审核`
            }
          ]
        }))
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
        const messageId = assistantMsgIdRef.current
        if (!messageId) return
        setCurrentMessages((previous) =>
          previous.map((item) =>
            item.id === messageId
              ? { ...item, content: `${item.content || ''}${event.token}` }
              : item
          )
        )
        updateActiveTurn((current) => ({
          ...current,
          finalAnswerMarkdown: `${current.finalAnswerMarkdown}${event.token}`,
          processGroups: completeAssistantProcessGroups(current.processGroups)
        }))
        scrollToBottom()
        return
      }

      if (event.type === 'answer_completed') {
        const messageId = assistantMsgIdRef.current
        if (!messageId || !currentSessionId) return
        setCurrentMessages((previous) =>
          previous.map((item) => (item.id === messageId ? { ...item, content: event.text } : item))
        )
        updateActiveTurn((current) => ({
          ...current,
          finalAnswerMarkdown: event.text,
          status: 'completed',
          processGroups: completeAssistantProcessGroups(current.processGroups)
        }))
        const assistantMessage: ChatMessage = {
          id: messageId,
          session_id: currentSessionId,
          role: 'assistant',
          content: event.text,
          timestamp: Date.now(),
          artifacts: assistantArtifactsRef.current[messageId] || []
        }
        void window.api.chatMessageSave(assistantMessage).catch(console.error)
        return
      }

      if (event.type === 'run_failed') {
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        updateActiveTurn((current) => ({
          ...current,
          status: 'failed',
          error: event.error
        }))
        const messageId = assistantMsgIdRef.current
        if (messageId) {
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
        }
        emitErrorMessage(event.error || '运行失败')
        return
      }

      if (event.type === 'run_cancelled') {
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        updateActiveTurn((current) => ({
          ...current,
          status: 'failed',
          error: '已取消'
        }))
        message.info('已取消')
        return
      }

      if (event.type === 'run_completed') {
        setLoading(false)
        setAiRunId(null)
        setCancellingRun(false)
        setPendingApprovalBatch(null)
        setApprovalSubmitting(false)
        updateActiveTurn((current) => ({
          ...current,
          status: current.status === 'failed' ? 'failed' : 'completed'
        }))
        if (currentSessionId) {
          void loadFileChangesForSession(currentSessionId, { autoOpen: true })
        }
        void refreshContextUsage(currentSessionId)
      }
    })
    return () => {
      window.api.removeAiRunEventListeners()
    }
    // AI run listener is intentionally keyed by active run/session identity to avoid resubscribing on UI helper changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRunId, currentSessionId, message, refreshContextUsage])

  const updateSessionTitleIfNeeded = async (userQuery: string): Promise<void> => {
    if (!currentSessionId || currentMessages.length !== 0) return
    const currentSession = sessions.find((item) => item.id === currentSessionId)
    if (!currentSession) return
    await window.api.chatSessionSave({ ...currentSession, title: userQuery.slice(0, 20) })
    await loadSessions()
  }

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
    const likelyExecutable =
      /\b(cmd|bash|shell|terminal|command|run)\b/i.test(userQuery) ||
      /终端|命令|脚本|执行|创建文件|删除文件|修改文件/.test(userQuery)
    if (likelyExecutable && !selectedWorkspaceReady) {
      message.warning('该请求可能触发本地执行，请先选择当前工作区，必要时再通过 @ 插入文件或目录')
      return
    }

    setInput('')
    setSelectedReferences([])
    setComposerResetKey((value) => value + 1)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setLoading(true)
    setCancellingRun(false)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = userQuery

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now(),
      selectedReferences: selectedReferences.length > 0 ? selectedReferences : undefined,
      error: false
    }

    setCurrentMessages((previous) => [...previous, userMessage])
    void window.api.chatMessageSave(userMessage).catch(console.error)

    await updateSessionTitleIfNeeded(userQuery)

    try {
      const assistantMessageId = crypto.randomUUID()
      assistantMsgIdRef.current = assistantMessageId
      setAssistantTurns((previous) => ({
        ...previous,
        [assistantMessageId]: createAssistantTurn(assistantMessageId)
      }))

      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        session_id: currentSessionId,
        role: 'assistant',
        content: '',
        timestamp: Date.now()
      }
      setCurrentMessages((previous) => [...previous, assistantMessage])
      assistantArtifactsRef.current[assistantMessageId] = []

      const response = await window.api.aiRunStart({
        sessionId: currentSessionId,
        input: userQuery,
        selectedReferences: selectedReferences.length > 0 ? selectedReferences : undefined,
        modelName: selectedModelName,
        workspace: createWorkspaceBinding(selectedWorkspace)
      })
      if (!response.success || !response.runId) {
        setLoading(false)
        emitErrorMessage(response.error || '启动失败')
        return
      }
      setAiRunId(response.runId)
      setAssistantTurns((previous) => ({
        ...previous,
        [assistantMessageId]: {
          ...previous[assistantMessageId],
          runId: response.runId
        }
      }))
    } catch (error) {
      console.error(error)
      setLoading(false)
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
    const hasStrictScope = selectedReferences.length > 0 || Boolean(selectedWorkspace)
    if (hasStrictScope && kbScopeDocumentIds.length === 0) {
      message.warning('当前搜索范围没有已索引资料，无法执行纯搜索。')
      return
    }

    setInput('')
    setSelectedReferences([])
    setComposerResetKey((value) => value + 1)
    shouldAutoScrollRef.current = true
    scrollToBottom(true)
    setLoading(true)
    setCancellingRun(false)
    setAiRunId(null)
    setPendingApprovalBatch(null)
    setApprovalSubmitting(false)

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now(),
      selectedReferences: selectedReferences.length > 0 ? selectedReferences : undefined
    }
    setCurrentMessages((previous) => [...previous, userMessage])
    void window.api.chatMessageSave(userMessage).catch(console.error)

    let assistantMessageId: string | null = null
    let assistantMessage: ChatMessage | null = null

    try {
      await updateSessionTitleIfNeeded(userQuery)
      const nextAssistantMessageId = crypto.randomUUID()
      assistantMessageId = nextAssistantMessageId
      setAssistantTurns((previous) => ({
        ...previous,
        [nextAssistantMessageId]: createSearchAssistantTurn(nextAssistantMessageId)
      }))

      const nextAssistantMessage: ChatMessage = {
        id: nextAssistantMessageId,
        session_id: currentSessionId,
        role: 'assistant',
        content: '',
        timestamp: Date.now()
      }
      assistantMessage = nextAssistantMessage
      setCurrentMessages((previous) => [...previous, nextAssistantMessage])

      const response = await window.api.search(
        userQuery,
        'all',
        hasStrictScope ? kbScopeDocumentIds : undefined
      )
      const results = response.results.map(parseIpcResult)
      const assistantContent =
        results.length > 0
          ? `已在当前资料范围中找到 ${results.length} 条结果，右侧可以直接查看命中详情。`
          : '未在当前资料范围中找到匹配结果。'
      const completedAssistantMessageId = assistantMessageId
      const completedAssistantMessage = assistantMessage
      completedAssistantMessage.content = assistantContent
      setCurrentMessages((previous) =>
        previous.map((item) =>
          item.id === completedAssistantMessageId ? completedAssistantMessage : item
        )
      )
      void window.api.chatMessageSave(completedAssistantMessage).catch(console.error)
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
        tokens: response.tokens
      })
    } catch (error) {
      console.error(error)
      if (assistantMessageId && assistantMessage) {
        const failedAssistantMessageId = assistantMessageId
        const failedAssistantMessage = assistantMessage
        failedAssistantMessage.content = '搜索失败了，请稍后再试。'
        setCurrentMessages((previous) =>
          previous.map((item) =>
            item.id === failedAssistantMessageId ? failedAssistantMessage : item
          )
        )
        setAssistantTurns((previous) => ({
          ...previous,
          [failedAssistantMessageId]: {
            ...(previous[failedAssistantMessageId] ||
              createSearchAssistantTurn(failedAssistantMessageId)),
            status: 'failed',
            processGroups: completeAssistantProcessGroups(
              previous[failedAssistantMessageId]?.processGroups ||
                createSearchAssistantTurn(failedAssistantMessageId).processGroups,
              'failed'
            ),
            finalAnswerMarkdown: '搜索失败了，请稍后再试。',
            error: '搜索失败了，请稍后再试。'
          }
        }))
      }
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
        const nextTabs = applyWorkspaceTabs.map((tab) =>
          tab.applyId === response.record!.id
            ? {
                ...tab,
                applyId: response.record!.id,
                sourcePath: response.record!.path,
                changeCount: response.record!.changeCount,
                status: response.record!.status,
                unseen: false
              }
            : tab
        )
        setApplyWorkspaceTabs(nextTabs)
        setActiveApplyRecord(fileChangeToDocxApplyRecord(response.record))
        showApplyWorkspace(nextTabs, response.record.path)
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
        const nextTabs = applyWorkspaceTabs.map((tab) =>
          tab.applyId === forced.record!.id
            ? {
                ...tab,
                applyId: forced.record!.id,
                sourcePath: forced.record!.path,
                changeCount: forced.record!.changeCount,
                status: forced.record!.status,
                unseen: false
              }
            : tab
        )
        setApplyWorkspaceTabs(nextTabs)
        setActiveApplyRecord(fileChangeToDocxApplyRecord(forced.record))
        showApplyWorkspace(nextTabs, forced.record.path)
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

  const openPathWithApplicationOrNotify = async (filePath: string): Promise<void> => {
    try {
      const picked = await window.api.pickApplication()
      if (picked.canceled) return
      if (!picked.appPath) {
        emitErrorMessage(picked.error || '未选择应用')
        return
      }
      const response = await window.api.openPathWithApplication({
        filePath,
        appPath: picked.appPath
      })
      if (!response.success) {
        emitErrorMessage(response.error || '使用指定应用打开失败')
      }
    } catch (error) {
      console.error(error)
      emitErrorMessage('使用指定应用打开失败')
    }
  }

  const renderUserMessage = (messageItem: ChatMessage): React.ReactNode => {
    const messageReferences = messageItem.selectedReferences || []
    return (
      <div key={messageItem.id} className="flex justify-end">
        <div className="max-w-[66%]">
          <div className="rounded-[22px] bg-[#F4F4F2] px-4 py-2.5 text-[14px] leading-6 text-[#37352F]">
            {messageReferences.length > 0 ? (
              <div
                className="mb-1.5 flex flex-wrap gap-1"
                data-testid={workbenchSelectors.userMessageReferences}
              >
                {messageReferences.map((reference) => (
                  <ReferenceInlineToken
                    key={
                      reference.kind === 'web'
                        ? `web:${reference.workspaceId}:${reference.webSourceId}`
                        : `${reference.kind}:${reference.workspaceId}:${reference.nodeId}`
                    }
                    reference={reference}
                  />
                ))}
              </div>
            ) : null}
            {messageItem.content}
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
        isStreaming={loading && assistantMsgIdRef.current === messageItem.id}
        onOpenFile={(file) => {
          void openFile(file)
        }}
        onOpenApply={openFileChange}
        onOpenReference={(reference) => {
          void openMarkdownReference(reference)
        }}
      />
    )
  }

  const handleComposerDraftChange = useCallback(
    (draft: { input: string; selectedReferences: SelectedReference[] }) => {
      setInput(draft.input)
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
      {sidebarCollapsed ? (
        <div className="nc-sidebar-titlebar-toggle-fixed-zone workbench-no-drag">
          <button
            type="button"
            className="nc-sidebar-titlebar-toggle nc-sidebar-titlebar-toggle-fixed workbench-no-drag"
            style={WORKBENCH_NO_DRAG_STYLE}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setSidebarCollapsed(false)
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            data-testid={workbenchSelectors.sessionsToggle}
            aria-label="展开侧边栏"
          >
            <SidebarPanelIcon className="h-4 w-4" variant="expand" />
          </button>
        </div>
      ) : null}
      <aside
        className={`nc-sidebar ${platform === 'darwin' ? 'nc-sidebar-mac' : ''} ${
          sidebarCollapsed ? 'nc-sidebar-hidden' : ''
        }`}
        style={{ width: sidebarWidth, flexBasis: sidebarWidth }}
      >
        <div aria-hidden="true" style={WORKBENCH_TOP_DRAG_ZONE_STYLE} />
        {!sidebarCollapsed ? (
          <button
            type="button"
            className="nc-sidebar-titlebar-toggle nc-sidebar-titlebar-toggle-inside workbench-no-drag"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setSidebarCollapsed(true)
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            data-testid={workbenchSelectors.sessionsToggle}
            aria-label="收起侧边栏"
          >
            <SidebarPanelIcon className="h-4 w-4" variant="collapse" />
          </button>
        ) : null}
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
                        className={`nc-sidebar-item group relative ${
                          currentSessionId === session.id
                            ? 'nc-sidebar-item-active'
                            : 'bg-transparent'
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
                          <div className="flex shrink-0 items-center gap-1 text-[11px] text-[#91918E] group-hover:hidden">
                            <HiClock className="h-3 w-3" />
                            <span>{formatRelativeTime(session.created_at)}</span>
                          </div>
                          <Button
                            type="text"
                            size="small"
                            icon={<HiTrash className="h-3.5 w-3.5" />}
                            className="!absolute !right-1 !top-1/2 !z-10 !h-6 !w-6 !-translate-y-1/2 !rounded-[6px] !p-0 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={(event) => void deleteSession(event, session.id)}
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
          onPointerDown={(event) => {
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
        {sidebarCollapsed ? (
          <div
            aria-hidden="true"
            className="workbench-no-drag"
            style={WORKBENCH_COLLAPSED_TOPBAR_NO_DRAG_ZONE_STYLE}
          />
        ) : null}
        <div
          aria-hidden="true"
          style={{
            ...WORKBENCH_TOP_DRAG_ZONE_STYLE,
            left: sidebarCollapsed ? WORKBENCH_COLLAPSED_SIDEBAR_TOGGLE_SAFE_WIDTH : 0
          }}
        />
        <div className="flex h-full min-h-0 flex-col">
          {!isNewSession ? (
            <div className="nc-topbar">
              <div className="min-w-0 flex-1 bg-white">
                {currentSession || sharedHeaderMeta ? (
                  <div className="flex min-w-0 items-center gap-2 leading-none">
                    {currentSession ? (
                      <div className="truncate text-sm font-semibold leading-none text-[#37352F]">
                        {currentSession.title}
                      </div>
                    ) : null}
                    {currentSession && sharedHeaderMeta ? (
                      <span className="text-[#E0DFDC]">/</span>
                    ) : null}
                    {sharedHeaderMeta ? (
                      <div
                        className="truncate text-sm font-semibold leading-none text-[#37352F]"
                        data-testid={workbenchSelectors.contentPanelTitle}
                      >
                        {sharedHeaderMeta.title}
                      </div>
                    ) : null}
                    {sharedHeaderMeta?.badge ? (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${sharedHeaderMeta.badgeClassName}`}
                      >
                        {sharedHeaderMeta.badge}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div
                className="nc-topbar-drag-spacer"
                style={WORKBENCH_DRAG_REGION_STYLE}
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
                className="!flex !h-7 !w-7 !items-center !justify-center !rounded-[6px] !border-0 !bg-transparent !p-0 !shadow-none !text-[#91918E] hover:!bg-transparent hover:!text-[#37352F]"
                style={WORKBENCH_NO_DRAG_REGION_STYLE}
                onClick={() => setContentPanelCollapsed((previous) => !previous)}
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
                        className="overflow-hidden rounded-[12px] border border-[#E0DFDC] bg-[#FFFFFF] shadow-[0_8px_24px_rgba(15,15,15,0.08)]"
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
                            <code className="mx-5 mt-3 block overflow-hidden whitespace-pre-wrap break-words rounded-[6px] border border-[#EEEEEC] bg-[#F4F4F2] px-3.5 py-3 font-mono text-[13px] leading-6 text-[#2F3437]">
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
              style={{
                width: contentPanelCollapsed
                  ? 0
                  : contentPanel.kind === 'apply_workspace'
                    ? 'min(48vw, 780px)'
                    : contentPanel.kind === 'browser'
                      ? 'min(52vw, 860px)'
                      : contentPanel.kind === 'file_preview'
                        ? 'min(46vw, 740px)'
                        : 440
              }}
            >
              <WorkbenchContentPanel
                state={contentPanel}
                activeApplyRecord={activeApplyRecord}
                applyLoading={applyLoading}
                applyReverting={applyReverting}
                onOpenSearchResult={(turn, resultIndex) => void openSearchResult(turn, resultIndex)}
                onSelectApplyTab={(fileKey) => {
                  const nextTab = applyWorkspaceTabs.find((tab) => tab.fileKey === fileKey)
                  if (!nextTab) return
                  const nextTabs = applyWorkspaceTabs.map((tab) =>
                    tab.fileKey === fileKey ? { ...tab, unseen: false } : tab
                  )
                  setApplyWorkspaceTabs(nextTabs)
                  void loadApplyRecord({
                    applyId: nextTab.applyId,
                    tabs: nextTabs,
                    activeFileKey: fileKey,
                    openWorkspace: true
                  })
                }}
                onRevertApply={() => void handleApplyRevert()}
                onBackToPanelState={showContentPanel}
                onOpenPath={openPathOrNotify}
                onOpenWithApplication={openPathWithApplicationOrNotify}
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
      </div>
    </div>
  )
}

export default ChatPage
