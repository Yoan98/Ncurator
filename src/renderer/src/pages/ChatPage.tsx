import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Modal, Spin } from 'antd'
import {
  HiArrowUp,
  HiBookOpen,
  HiCheck,
  HiChevronLeft,
  HiChevronRight,
  HiOutlineExclamationCircle,
  HiOutlinePencilSquare,
  HiOutlineRectangleGroup,
  HiOutlineViewColumns,
  HiRectangleGroup,
  HiStop,
  HiTrash,
  HiViewColumns,
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
import SettingsMenuButton from '../components/settings/SettingsMenuButton'
import AssistantTurnCard from '../components/workbench/AssistantTurnCard'
import WorkbenchComposer from '../components/workbench/WorkbenchComposer'
import WorkbenchContentPanel from '../components/workbench/WorkbenchContentPanel'
import {
  FILE_CHANGE_STATUS_META,
  FILE_ORIGIN_LABELS,
  WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY,
  WORKBENCH_SIDEBAR_STORAGE_KEY
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
  formatSessionDate,
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
import brandIcon from '../../../../resources/icon.png'
import {
  collectReferenceDocumentIds,
  hasIncompleteLocalKbCoverage,
  pruneReferencesByWorkspace
} from '../utils/reference'

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
  workspace
    ? '当前工作区未设置文件目录，请前往 设置 > 工作空间 绑定地址'
    : '请先选择工作区'

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

const ChatPage: React.FC = () => {
  const { message, modal } = App.useApp()
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

  const composerWorkspaceHint = useMemo(() => {
    if (selectedWorkspaceReady) return null
    return getWorkspaceRequirementHint(selectedWorkspace)
  }, [selectedWorkspace, selectedWorkspaceReady])

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

  const emitSuccessMessage = (content: string): void => {
    if (typeof message.success === 'function') {
      message.success(content)
      return
    }
    if (typeof message.open === 'function') {
      message.open({ type: 'success', content })
    }
  }

  const emitErrorMessage = (content: string): void => {
    if (typeof message.error === 'function') {
      message.error(content)
      return
    }
    if (typeof message.open === 'function') {
      message.open({ type: 'error', content })
    }
  }

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
        badgeClassName: 'border-[#E1DED6] bg-white text-[#6E6D69]'
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

  const loadSessions = async (): Promise<void> => {
    try {
      const list = await window.api.chatSessionList()
      setSessions(list)
      if (list.length > 0 && !currentSessionId) {
        setCurrentSessionId(list[0].id)
      } else if (list.length === 0) {
        await createNewSession()
      }
    } catch (error) {
      console.error('Failed to load sessions', error)
    }
  }

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
    [activeModelConfig, message]
  )

  const handleModeChange = useCallback((mode: WorkbenchMode): void => {
    setComposerMode(mode)
    writeWorkbenchModePreference(window.localStorage, mode)
  }, [])

  const handleWorkspaceChange = useCallback((workspaceId: string | null): void => {
    setSelectedWorkspaceId(workspaceId)
    writeWorkbenchWorkspacePreference(window.localStorage, workspaceId)
  }, [])

  const createNewSession = async (): Promise<void> => {
    try {
      const timestamp = Date.now()
      const nextSession: ChatSession = {
        id: crypto.randomUUID(),
        title: '新对话',
        created_at: timestamp
      }
      await window.api.chatSessionSave(nextSession)
      await loadSessions()
      setCurrentSessionId(nextSession.id)
    } catch (error) {
      console.error(error)
      emitErrorMessage('创建会话失败')
    }
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
  }, [loadModelConfigs, loadWorkspaces])

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
    window.localStorage.setItem(
      WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY,
      String(contentPanelCollapsed)
    )
  }, [contentPanelCollapsed])

  useEffect(() => {
    if (currentSessionId) {
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
      timestamp: Date.now()
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
    return (
      <div key={messageItem.id} className="flex justify-end">
        <div className="max-w-[66%]">
          <div className="rounded-[18px] border border-[#CBC7BD] bg-[#E8E6DF] px-3.5 py-2.5 text-[14px] leading-6 text-[#181818]">
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
          <div className="min-w-0 text-[15px] leading-7 text-[#181818]">
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

  return (
    <div
      className="flex min-h-screen bg-[#F6F5F1]"
      data-testid={workbenchSelectors.page}
      data-workbench-mode={composerMode}
    >
      <aside
        className={`flex h-screen flex-col border-r border-[#E1DED6] bg-[#F7F5F1] transition-all duration-200 ${
          sidebarCollapsed ? 'w-14' : 'w-[220px]'
        }`}
      >
        <div className="border-b border-[#E1DED6] px-2 py-2">
          <div
            className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-1.5' : 'items-center justify-between gap-2'}`}
          >
            {sidebarCollapsed ? (
              <span className="ui-icon-well flex h-7 w-7 bg-white">
                <img src={brandIcon} alt="馆长" className="w-4 invert-100" />
              </span>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <span className="ui-icon-well flex h-7 w-7 shrink-0 bg-white">
                  <img src={brandIcon} alt="馆长" className="w-4 invert-100" />
                </span>
                <span className="truncate text-[13px] font-semibold tracking-[0.01em] text-[#181818]">
                  馆长
                </span>
              </div>
            )}

            <div className={`flex items-center gap-1 ${sidebarCollapsed ? 'flex-col' : ''}`}>
              <Button
                type="text"
                size="small"
                icon={<HiOutlinePencilSquare className="h-3 w-3" />}
                className="!flex !h-7 !w-7 !items-center !justify-center !rounded-[10px] !border !border-[#E1DED6] !bg-white !p-0 !text-[#181818] !shadow-none hover:!border-[#181818] hover:!text-[#3F3F3D]"
                onClick={() => void createNewSession()}
                data-testid={workbenchSelectors.newSessionButton}
              />
              <Button
                type="text"
                size="small"
                icon={
                  sidebarCollapsed ? (
                    <HiOutlineViewColumns className="h-3 w-3" />
                  ) : (
                    <HiViewColumns className="h-3 w-3" />
                  )
                }
                className={`!flex !h-7 !w-7 !items-center !justify-center !rounded-[10px] !border !p-0 !shadow-none hover:!border-[#181818] hover:!text-[#181818] ${
                  sidebarCollapsed
                    ? '!border-[#E1DED6] !bg-white !text-[#6E6D69]'
                    : '!border-[#E1DED6] !bg-[#F0EFEB] !text-[#181818]'
                }`}
                onClick={() => setSidebarCollapsed((previous) => !previous)}
                data-testid={workbenchSelectors.sessionsToggle}
              />
            </div>
          </div>
        </div>

        <div
          className="flex-1 space-y-1 overflow-y-auto px-2 py-2"
          data-testid={workbenchSelectors.sessionsList}
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              className={`group relative w-full rounded-[14px] border text-left transition-all duration-200 ${
                currentSessionId === session.id
                  ? 'border-[#E1DED6] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                  : 'border-transparent bg-transparent hover:border-[#E8E6DF] hover:bg-white/80'
              } ${sidebarCollapsed ? 'px-2 py-2' : 'px-3 py-2'}`}
              onClick={() => setCurrentSessionId(session.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setCurrentSessionId(session.id)
                }
              }}
            >
              {sidebarCollapsed ? (
                <div className="flex justify-center text-xs font-medium text-[#181818]">
                  {session.title.slice(0, 1)}
                </div>
              ) : (
                <>
                  <div className="truncate pr-6 text-[13px] font-medium text-[#181818]">
                    {session.title}
                  </div>
                  <div className="mt-1 text-[12px] text-[#9C9A94]">
                    {formatSessionDate(session.created_at)}
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<HiTrash className="h-3.5 w-3.5" />}
                    className="!absolute !bottom-1.5 !right-1.5 !left-auto !top-auto !z-10 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(event) => void deleteSession(event, session.id)}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        <div className="px-2 py-2">
          <SettingsMenuButton
            label={sidebarCollapsed ? undefined : '设置'}
            placement={sidebarCollapsed ? 'topRight' : 'topLeft'}
            className={`!h-7 !rounded-[10px] ${
              sidebarCollapsed ? '!w-7 !px-0' : '!w-full !justify-start !px-2.5'
            }`}
          />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex h-screen min-h-0 flex-col">
          <div
            className={`flex h-11 shrink-0 items-center justify-between bg-[#F6F5F1] px-4 ${
              contentPanelCollapsed ? '' : 'border-b border-[#E1DED6]'
            }`}
          >
            <div className="min-w-0 flex-1">
              {currentSession || sharedHeaderMeta ? (
                <div className="flex min-w-0 items-center gap-2">
                  {currentSession ? (
                    <div className="truncate text-sm font-semibold text-[#181818]">
                      {currentSession.title}
                    </div>
                  ) : null}
                  {currentSession && sharedHeaderMeta ? (
                    <span className="text-[#CBC7BD]">/</span>
                  ) : null}
                  {sharedHeaderMeta ? (
                    <div
                      className="truncate text-sm font-semibold text-[#181818]"
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

            <Button
              type="text"
              size="small"
              icon={
                contentPanelCollapsed ? (
                  <HiOutlineRectangleGroup className="h-3 w-3" />
                ) : (
                  <HiRectangleGroup className="h-3 w-3" />
                )
              }
              className={`!flex !h-7 !w-7 !items-center !justify-center !rounded-[10px] !border !p-0 !shadow-none hover:!border-[#181818] hover:!text-[#181818] ${
                contentPanelCollapsed
                  ? '!border-[#E1DED6] !bg-white !text-[#6E6D69]'
                  : '!border-[#E1DED6] !bg-[#F0EFEB] !text-[#181818]'
              }`}
              onClick={() => setContentPanelCollapsed((previous) => !previous)}
            />
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1">
              <div className="flex h-full min-h-0 flex-col">
                <div
                  className="min-h-0 flex-1 overflow-y-auto px-6 pt-4"
                  ref={scrollRef}
                  onScroll={handleMessageScroll}
                >
                  <div className="mx-auto flex max-w-[920px] flex-col gap-5 pb-8">
                    {currentMessages.length === 0 ? (
                      <div className="relative flex min-h-[58vh] items-center justify-center overflow-hidden px-8 py-12 text-center">
                        <div className="absolute inset-x-[12%] top-[18%] h-44 rounded-full bg-[radial-gradient(circle,rgba(255,253,248,0.9),rgba(240,239,235,0.48)_42%,rgba(246,245,241,0)_76%)] blur-2xl" />
                        <div className="absolute inset-x-[20%] bottom-[20%] h-32 rounded-full bg-[radial-gradient(circle,rgba(225,222,214,0.38),rgba(246,245,241,0)_72%)] blur-3xl" />
                        <div className="relative max-w-[420px]">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#FFFDF8]/70 text-[#6E6D69] shadow-[inset_0_0_0_1px_rgba(203,199,189,0.7)] backdrop-blur-sm">
                            <HiBookOpen className="h-5 w-5" />
                          </div>
                          <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.01em] text-[#181818]">
                            从一个问题开始
                          </h3>
                          <p className="mt-2 text-[13px] leading-6 text-[#6E6D69]">
                            {composerMode === 'search'
                              ? '搜索模式只检索当前资料范围。'
                              : '智能模式会结合当前工作区与插入资料执行。'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      currentMessages.map((messageItem) =>
                        messageItem.role === 'user'
                          ? renderUserMessage(messageItem)
                          : renderAssistantMessage(messageItem)
                      )
                    )}
                  </div>
                </div>

                <div className="shrink-0 bg-gradient-to-t from-[#F6F5F1] via-[#F6F5F1]/96 via-58% to-transparent px-6 pb-6 pt-6">
                  <div className="mx-auto max-w-[920px]">
                    {composerMode === 'ai' && pendingApprovalBatch ? (
                      <div
                        className="overflow-hidden rounded-[24px] border border-[#CBC7BD] bg-[#FFFDF8] shadow-[0_22px_52px_rgba(24,24,24,0.12)]"
                        data-testid={chatSelectors.approvalBatchCard}
                      >
                        {pendingApprovalBatch && currentApprovalItem ? (
                          <div>
                            <div className="flex items-center justify-between gap-3 px-5 pt-4">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="min-w-0">
                                  <div className="text-[15px] font-semibold text-[#181818]">
                                    需要确认此操作
                                  </div>
                                  <div className="text-xs text-[#9C9A94]">
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
                                  className={`ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition ${
                                    cancellingRun
                                      ? 'bg-[#CBC7BD]'
                                      : 'bg-[#A83A31] shadow-[0_6px_14px_rgba(181,69,93,0.16)] hover:-translate-y-[1px] hover:bg-[#8F3028]'
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
                            <p className="mx-5 mt-3 text-[13px] leading-6 text-[#6E6D69]">
                              当前运行需要你授权本地操作。
                            </p>
                            <code className="mx-5 mt-3 block overflow-hidden whitespace-pre-wrap break-words rounded-[12px] border border-[#E1DED6] bg-[#F0EFEB] px-3.5 py-3 font-mono text-[13px] leading-6 text-[#3F3F3D]">
                              {currentApprovalItem.command}
                            </code>
                            <div className="mx-2 mt-3 space-y-1">
                              <button
                                type="button"
                                className="grid min-h-11 w-full grid-cols-[28px_1fr_auto] items-center rounded-[12px] px-3 text-left text-[13px] text-[#181818] shadow-[inset_3px_0_0_#181818,inset_0_0_0_1px_#E1DED6] hover:bg-[#F0EFEB]"
                                onClick={() =>
                                  void handleApprovalDecision({
                                    itemId: currentApprovalItem.itemId,
                                    action: 'approve'
                                  })
                                }
                                disabled={approvalSubmitting}
                                data-testid={chatSelectors.approvalBatchApproveButton}
                              >
                                <span className="text-[#9C9A94]">1.</span>
                                <span>允许本次操作</span>
                                <HiCheck className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className="grid min-h-11 w-full grid-cols-[28px_1fr_auto] items-center rounded-[12px] px-3 text-left text-[13px] text-[#6E6D69] hover:bg-[#F0EFEB]"
                                onClick={() =>
                                  void handleApprovalDecision({
                                    itemId: currentApprovalItem.itemId,
                                    action: 'reject'
                                  })
                                }
                                disabled={approvalSubmitting}
                                data-testid={chatSelectors.approvalBatchDenyButton}
                              >
                                <span className="text-[#9C9A94]">2.</span>
                                <span>拒绝本次操作</span>
                                <HiXMark className="h-4 w-4 text-[#A83A31]" />
                              </button>
                            </div>
                            <div className="mt-3 flex items-center gap-2 border-t border-[#E1DED6] px-4 py-4">
                              <input
                                className="min-w-0 flex-1 rounded-[12px] border border-[#E1DED6] bg-[#FFFDF8] px-3 py-2 text-sm text-[#181818] outline-none placeholder:text-[#9C9A94] focus:border-[#181818] focus:ring-2 focus:ring-[#E8E6DF]"
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
                                className="!flex !h-9 !items-center !gap-1 !rounded-full !border-[#181818] !bg-[#181818] !text-white hover:!bg-[#3F3F3D] disabled:!border-[#E1DED6] disabled:!bg-[#F0EFEB] disabled:!text-[#9C9A94]"
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
                        onWorkspaceChange={handleWorkspaceChange}
                        onDraftChange={handleComposerDraftChange}
                        onSubmit={() => void handleSend()}
                        onCancel={() => void handleCancel()}
                        loading={loading}
                        cancelling={cancellingRun}
                        submitHint={composerWorkspaceHint}
                        canSubmit={Boolean(
                          input.trim() &&
                          selectedWorkspaceReady &&
                          (composerMode === 'search' || selectedModelName)
                        )}
                        showCancel={composerMode === 'ai' && Boolean(aiRunId)}
                        resetKey={composerResetKey}
                        contextUsage={contextUsage}
                      />
                    )}

                    {composerMode === 'ai' &&
                    selectedReferences.some(hasIncompleteLocalKbCoverage) ? (
                      <div
                        className="mt-3 flex items-start gap-2 rounded-[14px] border border-[#E1DED6] bg-[#FAF9F5] px-3 py-2.5 text-sm text-[#6E6D69]"
                        data-testid={workbenchSelectors.referenceAiWarning}
                      >
                        <HiOutlineExclamationCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          已选本地参考资料含未完全索引内容，AI 可能需要直接读取原文件，耗时更长。
                        </span>
                      </div>
                    ) : null}

                    {composerMode === 'search' &&
                    selectedReferences.some(
                      (reference) =>
                        reference.kind === 'directory' && reference.kbAvailability === 'partial'
                    ) ? (
                      <div
                        className="mt-3 flex items-start gap-2 rounded-[14px] border border-[#E1DED6] bg-[#FAF9F5] px-3 py-2.5 text-sm text-[#6E6D69]"
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
