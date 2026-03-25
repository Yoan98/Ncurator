import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button } from 'antd'
import { HiBars3, HiBookOpen, HiOutlineViewColumns, HiPlus, HiTrash, HiUser } from 'react-icons/hi2'
import { HiViewColumns } from 'react-icons/hi2'
import type {
  AiRunEvent,
  ChatMessage,
  ChatSession,
  DraftChangeResolution,
  DraftReviewDetail,
  DraftReviewSummary,
  LLMConfig,
  SearchResult,
  SourceScopeSelection,
  ValidateDraftCommitResponse,
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
  WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY,
  WORKBENCH_SIDEBAR_STORAGE_KEY
} from '../components/workbench/constants'
import { FILE_ORIGIN_LABELS, REVIEW_STATUS_META } from '../components/workbench/constants'
import type {
  AssistantTurnReviewTarget,
  AssistantTurnStep,
  AssistantTurnViewModel,
  SearchWorkbenchTurn,
  WorkbenchContentPanelState,
  WorkbenchFileRef,
  WorkbenchMode
} from '../components/workbench/types'
import {
  dedupeFileRefs,
  extractReadableFilesFromToolOutput,
  extractSearchResultsFromToolOutput,
  formatSessionDate,
  getSearchResultFileRef,
  getToolBadge
} from '../components/workbench/utils'
import { chatSelectors, workbenchSelectors } from '../testing/selectors'
import brandIcon from '../../../../resources/icon.png'

type ApprovalRequiredEvent = Extract<AiRunEvent, { type: 'approval_required' }>
type WorkspaceRequiredEvent = Extract<AiRunEvent, { type: 'workspace_required' }>

const createEmptyPanel = (): WorkbenchContentPanelState => ({
  kind: 'empty',
  title: '',
  description: ''
})

const createAssistantTurn = (messageId: string): AssistantTurnViewModel => ({
  messageId,
  finalAnswer: '',
  status: 'running',
  steps: [],
  readFiles: [],
  editedFiles: [],
  reviewTargets: [],
  blockers: []
})

const sortDraftReviews = (items: DraftReviewSummary[]): DraftReviewSummary[] => {
  const priority: Record<DraftReviewSummary['status'], number> = {
    review_pending: 0,
    commit_ready: 1,
    conflicted: 2,
    failed: 3,
    committing: 4,
    committed: 5,
    cancelled: 6
  }
  return [...items].sort((left, right) => {
    const priorityGap = priority[left.status] - priority[right.status]
    if (priorityGap !== 0) return priorityGap
    return right.updated_at - left.updated_at
  })
}

const createWorkspaceBinding = (
  workspace: WorkspaceSource | null
): WorkspaceRuntimeBinding | undefined =>
  workspace
    ? {
        workspaceId: workspace.id,
        rootPath: workspace.root_path
      }
    : undefined

const ChatPage: React.FC = () => {
  const { message } = App.useApp()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [composerMode, setComposerMode] = useState<WorkbenchMode>('ai')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiRunId, setAiRunId] = useState<string | null>(null)
  const [searchTurn, setSearchTurn] = useState<SearchWorkbenchTurn | null>(null)
  const [selectedSourceScopes, setSelectedSourceScopes] = useState<SourceScopeSelection[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSource[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [modelConfigs, setModelConfigs] = useState<LLMConfig[]>([])
  const [selectedModelConfigId, setSelectedModelConfigId] = useState<string | null>(null)
  const [composerResetKey, setComposerResetKey] = useState(0)
  const [assistantTurns, setAssistantTurns] = useState<Record<string, AssistantTurnViewModel>>({})
  const [contentPanel, setContentPanel] = useState<WorkbenchContentPanelState>(createEmptyPanel())
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_STORAGE_KEY)
    return stored === 'true'
  })
  const [contentPanelCollapsed, setContentPanelCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  })

  const [activeDraftReviewId, setActiveDraftReviewId] = useState<string | null>(null)
  const [activeDraftReview, setActiveDraftReview] = useState<DraftReviewDetail | null>(null)
  const [draftReviewLoading, setDraftReviewLoading] = useState(false)
  const [draftCommitValidation, setDraftCommitValidation] =
    useState<ValidateDraftCommitResponse | null>(null)
  const [draftValidationLoading, setDraftValidationLoading] = useState(false)
  const [draftDecisionBusyIds, setDraftDecisionBusyIds] = useState<string[]>([])
  const [draftBulkApplying, setDraftBulkApplying] = useState(false)
  const [draftCommitSubmitting, setDraftCommitSubmitting] = useState(false)

  const [pendingApprovalRequest, setPendingApprovalRequest] =
    useState<ApprovalRequiredEvent | null>(null)
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const [pendingWorkspaceRequest, setPendingWorkspaceRequest] = useState<{
    input: string
    scopes: SourceScopeSelection[]
    reason: string
    request: WorkspaceRequiredEvent
  } | null>(null)

  const assistantMsgIdRef = useRef<string | null>(null)
  const lastSubmittedInputRef = useRef('')
  const lastSubmittedScopesRef = useRef<SourceScopeSelection[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const selectedDocumentIds = useMemo(
    () =>
      Array.from(
        new Set(
          selectedSourceScopes.flatMap((scope) =>
            Array.isArray(scope.documentIds) ? scope.documentIds.map((item) => String(item)) : []
          )
        )
      ).filter(Boolean),
    [selectedSourceScopes]
  )

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null,
    [selectedWorkspaceId, workspaces]
  )

  const reviewTurn = useMemo(() => {
    if (!activeDraftReview) return undefined
    return Object.values(assistantTurns).find(
      (turn) => turn.runId === activeDraftReview.review.run_id
    )
  }, [activeDraftReview, assistantTurns])

  const scrollToBottom = (): void => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }

  const showContentPanel = useCallback((nextState: WorkbenchContentPanelState): void => {
    setContentPanel(nextState)
    setContentPanelCollapsed(false)
  }, [])

  const sharedHeaderMeta = useMemo(() => {
    if (contentPanelCollapsed || contentPanel.kind === 'empty') {
      return null
    }

    if (contentPanel.kind === 'document_view') {
      return {
        title: contentPanel.file.fileName || contentPanel.title,
        badge: FILE_ORIGIN_LABELS[contentPanel.file.origin],
        badgeClassName: 'border-[#E5E5E4] bg-white text-[#666666]'
      }
    }

    if (contentPanel.kind === 'review_session' && contentPanel.review) {
      const statusMeta = REVIEW_STATUS_META[contentPanel.review.review.status]
      return {
        title: contentPanel.title,
        badge: statusMeta.label,
        badgeClassName: statusMeta.className
      }
    }

    return {
      title: contentPanel.title,
      badge: null,
      badgeClassName: ''
    }
  }, [contentPanel, contentPanelCollapsed])

  const resetDraftReviewState = (): void => {
    setActiveDraftReviewId(null)
    setActiveDraftReview(null)
    setDraftReviewLoading(false)
    setDraftCommitValidation(null)
    setDraftValidationLoading(false)
    setDraftDecisionBusyIds([])
    setDraftBulkApplying(false)
    setDraftCommitSubmitting(false)
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
    if (!result.success) message.error(result.error || '打开失败')
  }

  const revealPathOrNotify = async (filePath: string): Promise<void> => {
    const result = await window.api.revealPath(filePath)
    if (!result.success) message.error(result.error || '定位失败')
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
      scrollToBottom()
    } catch (error) {
      console.error('Failed to load messages', error)
    }
  }

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    try {
      const response = await window.api.workspaceList()
      setWorkspaces(response.items)
      setSelectedWorkspaceId((current) => {
        if (current && response.items.some((workspace) => workspace.id === current)) return current
        return response.items[0]?.id || null
      })
    } catch (error) {
      console.error('Failed to load workspaces', error)
    }
  }, [])

  const loadModelConfigs = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.llmConfigList()
      setModelConfigs(list)
      setSelectedModelConfigId((current) => {
        if (current && list.some((config) => config.id === current)) return current
        return list.find((config) => config.is_active)?.id || list[0]?.id || null
      })
    } catch (error) {
      console.error('Failed to load llm configs', error)
    }
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
      message.error('创建会话失败')
    }
  }

  const loadDraftReviewDetail = async (reviewId: string): Promise<void> => {
    setDraftReviewLoading(true)
    try {
      const [detailResponse, validationResponse] = await Promise.all([
        window.api.draftReviewGet({ reviewId }),
        window.api.draftReviewValidate({ reviewId })
      ])
      if (!detailResponse.review) {
        setActiveDraftReview(null)
        setDraftCommitValidation(validationResponse)
        return
      }
      setActiveDraftReview(detailResponse.review)
      setActiveDraftReviewId(reviewId)
      setDraftCommitValidation(validationResponse)
      showContentPanel({
        kind: 'review_session',
        title: '修改确认',
        reviewId,
        review: detailResponse.review
      })
    } finally {
      setDraftReviewLoading(false)
    }
  }

  const loadDraftReviewsForSession = async (
    sessionId: string,
    preferredReviewId?: string | null
  ): Promise<void> => {
    setDraftReviewLoading(true)
    try {
      const response = await window.api.draftReviewList({ sessionId })
      const nextItems = sortDraftReviews(response.items)

      const currentSelectedId = preferredReviewId || activeDraftReviewId
      const nextReviewId =
        nextItems.find((item) => item.id === currentSelectedId)?.id || nextItems[0]?.id || null
      if (!nextReviewId) {
        setActiveDraftReviewId(null)
        setActiveDraftReview(null)
        setDraftCommitValidation(null)
        return
      }
      await loadDraftReviewDetail(nextReviewId)
      const reviewMap = new Map(nextItems.map((item) => [item.run_id, item]))
      setAssistantTurns((previous) => {
        const nextTurns: Record<string, AssistantTurnViewModel> = { ...previous }
        Object.values(previous).forEach((turn) => {
          if (!turn.runId) return
          const review = reviewMap.get(turn.runId)
          if (!review) return
          const target: AssistantTurnReviewTarget = {
            reviewId: review.id,
            title: review.title,
            changeCount: review.change_count,
            documentCount: review.document_count,
            status: review.status
          }
          nextTurns[turn.messageId] = {
            ...turn,
            reviewTargets: [target]
          }
        })
        return nextTurns
      })
    } catch (error) {
      console.error('Failed to load draft reviews', error)
      setActiveDraftReview(null)
      setDraftCommitValidation(null)
    } finally {
      setDraftReviewLoading(false)
    }
  }

  const refreshDraftCommitValidation = async (reviewId: string): Promise<void> => {
    setDraftValidationLoading(true)
    try {
      const response = await window.api.draftReviewValidate({ reviewId })
      setDraftCommitValidation(response)
    } finally {
      setDraftValidationLoading(false)
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
    window.api.sourceListRefresh(refreshSources)
    return () => {
      window.api.removeSourceListRefreshListeners()
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
      setSearchTurn(null)
      setInput('')
      setSelectedSourceScopes([])
      setComposerResetKey((value) => value + 1)
      setPendingApprovalRequest(null)
      setApprovalSubmitting(false)
      setPendingWorkspaceRequest(null)
      setAssistantTurns({})
      setContentPanel(createEmptyPanel())
      resetDraftReviewState()
      void loadDraftReviewsForSession(currentSessionId)
    } else {
      setCurrentMessages([])
      setAssistantTurns({})
      resetDraftReviewState()
    }
  }, [currentSessionId])

  useEffect(() => {
    scrollToBottom()
  }, [currentMessages])

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
      message.error('删除会话失败')
    }
  }

  const openFile = async (file: WorkbenchFileRef): Promise<void> => {
    if (/^https?:\/\//.test(file.path)) {
      const response = await window.api.openExternal(file.path)
      if (!response.success) {
        message.error(response.error || '打开链接失败')
      }
      return
    }

    showContentPanel({
      kind: 'document_view',
      title: '文档查看',
      file
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
        message.error(response.error || '打开链接失败')
      }
      return
    }

    const fileRef = getSearchResultFileRef(result)
    if (!fileRef) {
      message.warning('未找到文件路径')
      return
    }
    setSearchTurn(turn)
    showContentPanel({
      kind: 'document_view',
      title: '文档查看',
      file: fileRef,
      searchResult: result
    })
  }

  const openDraftReview = (reviewId: string): void => {
    void loadDraftReviewDetail(reviewId)
  }

  useEffect(() => {
    if (!aiRunId) return
    window.api.removeAiRunEventListeners()
    window.api.onAiRunEvent((event) => {
      if (event.runId !== aiRunId) return

      if (event.type === 'human_step') {
        const nextStep: AssistantTurnStep = {
          id: `${event.taskId}:${event.stepIndex}`,
          summary: event.summary || event.publicNarrative,
          tool: getToolBadge(event.toolName, event.action),
          status:
            event.resultStatus === 'error'
              ? 'failed'
              : event.draftRef
                ? 'review_needed'
                : 'completed',
          files: []
        }
        updateActiveTurn((current) => {
          const stepIndex = current.steps.findIndex((item) => item.id === nextStep.id)
          if (stepIndex === -1) {
            return {
              ...current,
              steps: [...current.steps, nextStep]
            }
          }
          const nextSteps = [...current.steps]
          nextSteps[stepIndex] = nextStep
          return {
            ...current,
            steps: nextSteps
          }
        })
        return
      }

      if (event.type === 'tool_call_result') {
        const readFiles = extractReadableFilesFromToolOutput(
          event.outputPreview,
          event.toolName.includes('search') ? 'search_hit' : 'read'
        )
        if (readFiles.length > 0) {
          updateActiveTurn((current) => ({
            ...current,
            readFiles: dedupeFileRefs([...current.readFiles, ...readFiles]),
            steps: current.steps.map((step) =>
              step.tool === getToolBadge(event.toolName)
                ? { ...step, files: dedupeFileRefs([...step.files, ...readFiles]) }
                : step
            )
          }))
        }

        const searchResults = extractSearchResultsFromToolOutput(event.outputPreview)
        if (searchResults.length > 0) {
          showContentPanel({
            kind: 'search_results',
            title: '搜索结果',
            query: event.toolName,
            results: searchResults,
            tokens: []
          })
        }
        return
      }

      if (event.type === 'file_artifact') {
        const artifactFile: WorkbenchFileRef = {
          path: event.path,
          fileName: event.fileName,
          origin: event.reviewId ? 'edited_draft' : 'artifact',
          summary: event.summary,
          reviewId: event.reviewId,
          draftDocumentId: event.draftDocumentId
        }
        updateActiveTurn((current) => ({
          ...current,
          editedFiles: dedupeFileRefs([...current.editedFiles, artifactFile])
        }))
        return
      }

      if (event.type === 'workspace_required') {
        if (!event.internal) {
          setLoading(false)
          setPendingWorkspaceRequest({
            input: lastSubmittedInputRef.current,
            scopes: lastSubmittedScopesRef.current,
            reason: event.reason,
            request: event
          })
          message.warning(event.reason || '执行任务需要先绑定工作区')
        }
        updateActiveTurn((current) => ({
          ...current,
          blockers: [
            {
              kind: 'workspace',
              title: '等待补充工作区范围',
              description: event.reason
            }
          ]
        }))
        return
      }

      if (event.type === 'runtime_issue') {
        if (!event.internal) {
          setLoading(false)
          if (event.code === 'approval_denied') {
            setPendingApprovalRequest(null)
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

      if (event.type === 'approval_required') {
        if (!event.internal) {
          setLoading(false)
          setApprovalSubmitting(false)
          setPendingApprovalRequest(event)
          message.info(`命令需要审批：${event.command}`)
        }
        updateActiveTurn((current) => ({
          ...current,
          blockers: [
            {
              kind: 'approval',
              title: '等待审批',
              description: `${event.reason} · ${event.command}`
            }
          ]
        }))
        return
      }

      if (event.type === 'approval_decision') {
        if (event.internal) return
        setApprovalSubmitting(false)
        setPendingApprovalRequest(null)
        if (event.approved) {
          setLoading(true)
          message.success('审批已通过')
        } else {
          setLoading(false)
          message.warning(event.reason || '审批未通过')
          updateActiveTurn((current) => ({
            ...current,
            status: 'failed',
            error: event.reason || '审批未通过'
          }))
        }
        return
      }

      if (event.type === 'draft_review_ready') {
        updateActiveTurn((current) => ({
          ...current,
          reviewTargets: [
            {
              reviewId: event.review.reviewId,
              title: '待确认修改',
              changeCount: event.review.changeCount,
              documentCount: event.review.documentCount
            }
          ]
        }))
        if (!event.internal && currentSessionId) {
          message.success(`草稿审阅已准备完成：${event.review.changeCount} 处修改`)
          void loadDraftReviewsForSession(currentSessionId, event.review.reviewId)
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
          finalAnswer: `${current.finalAnswer}${event.token}`
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
          finalAnswer: event.text,
          status: 'completed'
        }))
        const assistantMessage: ChatMessage = {
          id: messageId,
          session_id: currentSessionId,
          role: 'assistant',
          content: event.text,
          timestamp: Date.now()
        }
        void window.api.chatMessageSave(assistantMessage).catch(console.error)
        return
      }

      if (event.type === 'run_failed') {
        setLoading(false)
        setPendingApprovalRequest(null)
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
                    content: `${item.content || ''}\n\n[失败] ${event.error}`
                  }
                : item
            )
          )
        }
        message.error(event.error || '运行失败')
        return
      }

      if (event.type === 'run_cancelled') {
        setLoading(false)
        setPendingApprovalRequest(null)
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
        setPendingApprovalRequest(null)
        setApprovalSubmitting(false)
        updateActiveTurn((current) => ({
          ...current,
          status: current.status === 'failed' ? 'failed' : 'completed'
        }))
      }
    })
    return () => {
      window.api.removeAiRunEventListeners()
    }
  }, [aiRunId, currentSessionId, message])

  const updateSessionTitleIfNeeded = async (userQuery: string): Promise<void> => {
    if (!currentSessionId || currentMessages.length !== 0) return
    const currentSession = sessions.find((item) => item.id === currentSessionId)
    if (!currentSession) return
    await window.api.chatSessionSave({ ...currentSession, title: userQuery.slice(0, 20) })
    await loadSessions()
  }

  const handleSend = async (): Promise<void> => {
    if (composerMode === 'search') {
      await handleSearchSend()
      return
    }
    if (!input.trim() || !currentSessionId || loading) return

    const userQuery = input.trim()
    const likelyExecutable =
      /\b(cmd|bash|shell|terminal|command|run)\b/i.test(userQuery) ||
      /终端|命令|脚本|执行|创建文件|删除文件|修改文件/.test(userQuery)
    const hasWorkspaceBinding =
      selectedSourceScopes.some((scope) => scope.workspace?.rootPath) || Boolean(selectedWorkspace)
    if (likelyExecutable && !hasWorkspaceBinding) {
      message.warning('该请求可能触发本地执行，请先选择当前工作区，必要时再通过 @ 插入文件或目录')
      return
    }

    setInput('')
    setSelectedSourceScopes([])
    setComposerResetKey((value) => value + 1)
    setLoading(true)
    setSearchTurn(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingWorkspaceRequest(null)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = userQuery
    lastSubmittedScopesRef.current = selectedSourceScopes
    setContentPanel(createEmptyPanel())

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now(),
      sources: undefined,
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

      const response = await window.api.aiRunStart({
        sessionId: currentSessionId,
        input: userQuery,
        selectedSourceScopes: selectedSourceScopes.length > 0 ? selectedSourceScopes : undefined,
        modelConfigId: selectedModelConfigId || undefined,
        workspace: createWorkspaceBinding(selectedWorkspace),
        allowNonLocal: false
      })
      if (!response.success || !response.runId) {
        setLoading(false)
        message.error(response.error || '启动失败')
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

      try {
        const searchResponse = await window.api.search(
          userQuery,
          'all',
          selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined
        )
        const parsedResults = searchResponse.results.map(parseIpcResult)
        const unique: SearchResult[] = []
        const seenIds = new Set<string>()
        for (const result of parsedResults) {
          if (result.document_id && !seenIds.has(result.document_id)) {
            seenIds.add(result.document_id)
            unique.push(result)
          }
        }
        userMessage.sources = JSON.stringify(unique.slice(0, 5))
        setCurrentMessages((previous) =>
          previous.map((item) => (item.id === userMessage.id ? userMessage : item))
        )
        void window.api.chatMessageSave(userMessage).catch(console.error)
      } catch {
        // ignore quick preview failures
      }
    } catch (error) {
      console.error(error)
      setLoading(false)
      message.error('发送失败')
    }
  }

  const handleSearchSend = async (): Promise<void> => {
    if (!input.trim() || !currentSessionId || loading) return

    const userQuery = input.trim()
    const hasStrictScope = selectedSourceScopes.length > 0
    if (hasStrictScope && selectedDocumentIds.length === 0) {
      message.warning('当前搜索范围没有已准备完成的本地资料，无法执行纯搜索。')
      return
    }

    setInput('')
    setSelectedSourceScopes([])
    setComposerResetKey((value) => value + 1)
    setLoading(true)
    setAiRunId(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingWorkspaceRequest(null)
    setContentPanel(createEmptyPanel())

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now()
    }
    setCurrentMessages((previous) => [...previous, userMessage])
    void window.api.chatMessageSave(userMessage).catch(console.error)

    try {
      await updateSessionTitleIfNeeded(userQuery)
      const response = await window.api.search(
        userQuery,
        'all',
        hasStrictScope ? selectedDocumentIds : undefined
      )
      const results = response.results.map(parseIpcResult)
      const assistantContent =
        results.length > 0
          ? `已在当前资料范围中找到 ${results.length} 条结果，右侧可以直接查看命中详情。`
          : '未在当前资料范围中找到匹配结果。'
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        session_id: currentSessionId,
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now()
      }
      setCurrentMessages((previous) => [...previous, assistantMessage])
      void window.api.chatMessageSave(assistantMessage).catch(console.error)

      const nextTurn: SearchWorkbenchTurn = {
        query: userQuery,
        results,
        tokens: response.tokens,
        createdAt: Date.now()
      }
      setSearchTurn(nextTurn)
      showContentPanel({
        kind: 'search_results',
        title: '搜索结果',
        query: userQuery,
        results,
        tokens: response.tokens
      })
    } catch (error) {
      console.error(error)
      message.error('搜索失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (!aiRunId) return
    try {
      const response = await window.api.aiRunCancel(aiRunId)
      if (!response.success) message.error(response.error || '取消失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消失败')
    }
  }

  const handleApprovalDecision = async (approved: boolean): Promise<void> => {
    if (!pendingApprovalRequest || approvalSubmitting) return
    setApprovalSubmitting(true)
    try {
      const response = await window.api.aiRunApprovalDecide({
        runId: pendingApprovalRequest.runId,
        approvalId: pendingApprovalRequest.approvalId,
        approved,
        reason: approved ? 'approved_in_chat_ui' : 'denied_in_chat_ui'
      })
      if (!response.success) {
        setApprovalSubmitting(false)
        message.error(response.error || '审批提交失败')
        return
      }
      if (approved) {
        setLoading(true)
      } else {
        setLoading(false)
      }
    } catch (error) {
      setApprovalSubmitting(false)
      message.error(error instanceof Error ? error.message : '审批提交失败')
    }
  }

  const handleContinueWithWorkspace = async (): Promise<void> => {
    if (!pendingWorkspaceRequest || !currentSessionId || loading) return
    const hasWorkspaceBinding =
      selectedSourceScopes.some((scope) => scope.workspace?.rootPath) || Boolean(selectedWorkspace)
    if (!hasWorkspaceBinding) {
      message.warning('请先选择当前工作区，必要时再通过 @ 插入目录或文件后继续')
      return
    }

    const continueMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: '已补充工作区上下文，请继续处理上一条请求。',
      timestamp: Date.now()
    }
    setCurrentMessages((previous) => [...previous, continueMessage])
    void window.api.chatMessageSave(continueMessage).catch(console.error)

    setLoading(true)
    setSearchTurn(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = pendingWorkspaceRequest.input
    lastSubmittedScopesRef.current = selectedSourceScopes

    try {
      const assistantMessageId = crypto.randomUUID()
      assistantMsgIdRef.current = assistantMessageId
      setAssistantTurns((previous) => ({
        ...previous,
        [assistantMessageId]: createAssistantTurn(assistantMessageId)
      }))
      setCurrentMessages((previous) => [
        ...previous,
        {
          id: assistantMessageId,
          session_id: currentSessionId,
          role: 'assistant',
          content: '',
          timestamp: Date.now()
        }
      ])

      const response = await window.api.aiRunStart({
        sessionId: currentSessionId,
        input: pendingWorkspaceRequest.input,
        selectedSourceScopes: selectedSourceScopes.length > 0 ? selectedSourceScopes : undefined,
        modelConfigId: selectedModelConfigId || undefined,
        workspace: createWorkspaceBinding(selectedWorkspace),
        allowNonLocal: false
      })
      if (!response.success || !response.runId) {
        setLoading(false)
        message.error(response.error || '继续运行失败')
        return
      }
      setPendingWorkspaceRequest(null)
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
      message.error('继续运行失败')
    }
  }

  const handleDraftChangeDecision = async (
    changeId: string,
    decision: DraftChangeResolution
  ): Promise<void> => {
    if (!activeDraftReview || !currentSessionId) return
    setDraftDecisionBusyIds((previous) => [...previous, changeId])
    try {
      const response = await window.api.draftReviewSetDecision({
        reviewId: activeDraftReview.review.id,
        changeId,
        decision
      })
      if (!response.success) {
        message.error(response.error || '更新草稿决策失败')
        return
      }
      await loadDraftReviewsForSession(currentSessionId, activeDraftReview.review.id)
    } catch (error) {
      console.error(error)
      message.error('更新草稿决策失败')
    } finally {
      setDraftDecisionBusyIds((previous) => previous.filter((item) => item !== changeId))
    }
  }

  const handleDraftBulkDecision = async (decision: DraftChangeResolution): Promise<void> => {
    if (!activeDraftReview || !currentSessionId || draftBulkApplying) return
    const pendingChanges = activeDraftReview.changes.filter(
      (change) => change.decision === 'pending'
    )
    if (pendingChanges.length === 0) return
    setDraftBulkApplying(true)
    try {
      for (const change of pendingChanges) {
        const response = await window.api.draftReviewSetDecision({
          reviewId: activeDraftReview.review.id,
          changeId: change.id,
          decision
        })
        if (!response.success) {
          throw new Error(response.error || 'bulk review decision failed')
        }
      }
      await loadDraftReviewsForSession(currentSessionId, activeDraftReview.review.id)
    } catch (error) {
      console.error(error)
      message.error('批量更新草稿决策失败')
    } finally {
      setDraftBulkApplying(false)
    }
  }

  const handleDraftValidationRefresh = async (): Promise<void> => {
    if (!activeDraftReview) return
    try {
      await refreshDraftCommitValidation(activeDraftReview.review.id)
    } catch (error) {
      console.error(error)
      message.error('刷新提交校验失败')
    }
  }

  const handleDraftCommit = async (): Promise<void> => {
    if (!activeDraftReview || !currentSessionId || draftCommitSubmitting) return
    setDraftCommitSubmitting(true)
    try {
      const validation = await window.api.draftReviewValidate({
        reviewId: activeDraftReview.review.id
      })
      setDraftCommitValidation(validation)
      if (!validation.ready) {
        message.warning('提交前仍有未决修改或源文件冲突。')
        return
      }
      const response = await window.api.draftReviewCommit({
        reviewId: activeDraftReview.review.id,
        overwrite: true
      })
      if (!response.success) {
        message.error(response.error || '提交失败')
      } else {
        message.success('已提交接受的修改到真实文件')
      }
      await loadDraftReviewsForSession(currentSessionId, activeDraftReview.review.id)
    } catch (error) {
      console.error(error)
      message.error('提交草稿失败')
    } finally {
      setDraftCommitSubmitting(false)
    }
  }

  const renderUserMessage = (messageItem: ChatMessage): React.ReactNode => {
    let sources: SearchResult[] = []
    try {
      if (messageItem.sources) {
        sources = JSON.parse(messageItem.sources) as SearchResult[]
      }
    } catch (error) {
      console.warn('Failed to parse sources', error)
    }

    return (
      <div key={messageItem.id} className="flex flex-row-reverse gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[#E5E5E4] bg-white text-[#1F1F1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <HiUser className="h-[18px] w-[18px]" />
        </div>
        <div className="max-w-[78%]">
          <div className="rounded-[20px] rounded-br-[10px] border border-[#E5E5E4] bg-white px-4 py-3.5 text-[14px] leading-7 text-[#1F1F1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {messageItem.content}
          </div>
          {sources.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {sources.map((source) => {
                const fileRef = getSearchResultFileRef(source)
                if (!fileRef) return null
                return (
                  <button
                    key={`${messageItem.id}-${source.id}`}
                    type="button"
                    onClick={() => void openFile(fileRef)}
                    className="rounded-full border border-[#E5E5E4] bg-white px-3 py-1.5 text-[12px] text-[#666666] transition-all duration-200 hover:border-[#D97757] hover:text-[#D97757]"
                  >
                    {source.document_name}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const renderAssistantMessage = (messageItem: ChatMessage): React.ReactNode => {
    const turn = assistantTurns[messageItem.id]
    if (!turn) {
      return (
        <div key={messageItem.id} className="flex gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]">
            <HiBookOpen className="h-[18px] w-[18px]" />
          </div>
          <div className="max-w-[82%] rounded-[20px] rounded-bl-[10px] border border-[#EAE2DD] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <MarkdownRenderer content={messageItem.content} />
          </div>
        </div>
      )
    }

    return (
      <AssistantTurnCard
        key={messageItem.id}
        messageId={messageItem.id}
        content={messageItem.content}
        turn={turn}
        isStreaming={loading && assistantMsgIdRef.current === messageItem.id}
        onOpenStep={(step) => {
          const firstFile = step.files[0]
          if (firstFile) {
            void openFile(firstFile)
            return
          }
          if (searchTurn) {
            showContentPanel({
              kind: 'search_results',
              title: '搜索结果',
              query: searchTurn.query,
              results: searchTurn.results,
              tokens: searchTurn.tokens
            })
          }
        }}
        onOpenFile={(file) => {
          void openFile(file)
        }}
        onOpenReview={openDraftReview}
      />
    )
  }

  const handleComposerDraftChange = useCallback(
    (draft: { input: string; selectedSourceScopes: SourceScopeSelection[] }) => {
      setInput(draft.input)
      setSelectedSourceScopes(draft.selectedSourceScopes)
    },
    []
  )

  return (
    <div
      className="flex min-h-screen bg-[#F5F5F4]"
      data-testid={workbenchSelectors.page}
      data-workbench-mode={composerMode}
    >
      <aside
        className={`flex h-screen flex-col border-r border-[#E5E5E4] bg-[#F8F6F2] transition-all duration-200 ${
          sidebarCollapsed ? 'w-14' : 'w-[220px]'
        }`}
      >
        <div className="border-b border-[#E5E5E4] px-2 py-2">
          <div
            className={`flex ${sidebarCollapsed ? 'flex-col items-center gap-1.5' : 'items-center justify-between gap-2'}`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[#FBF5F2]">
              <img src={brandIcon} alt="NCurator" className="w-5 invert-100" />
            </span>

            <div className={`flex items-center gap-1 ${sidebarCollapsed ? 'flex-col' : ''}`}>
              <Button
                type="text"
                size="small"
                icon={<HiPlus className="h-4 w-4" />}
                className="!flex !h-8 !w-8 !items-center !justify-center !rounded-xl !border !border-transparent !p-0 !text-[#D97757] hover:!border-[#E5E5E4] hover:!bg-white hover:!text-[#C66A4A]"
                onClick={() => void createNewSession()}
              />
              <Button
                type="text"
                size="small"
                icon={<HiBars3 className="h-4 w-4" />}
                className="!flex !h-8 !w-8 !items-center !justify-center !rounded-xl !border !border-transparent !p-0 !text-[#666666] hover:!border-[#E5E5E4] hover:!bg-white hover:!text-[#1F1F1F]"
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
              className={`group relative cursor-pointer rounded-2xl border transition-all duration-200 ${
                currentSessionId === session.id
                  ? 'border-[#F4E5DF] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                  : 'border-transparent bg-transparent hover:border-[#ECE7DF] hover:bg-white/80'
              } ${sidebarCollapsed ? 'px-2 py-3' : 'px-3 py-3'}`}
              onClick={() => setCurrentSessionId(session.id)}
            >
              {sidebarCollapsed ? (
                <div className="flex justify-center text-xs font-medium text-[#1F1F1F]">
                  {session.title.slice(0, 1)}
                </div>
              ) : (
                <>
                  <div className="truncate pr-6 text-[13px] font-medium text-[#1F1F1F]">
                    {session.title}
                  </div>
                  <div className="mt-1 text-[12px] text-[#999999]">
                    {formatSessionDate(session.created_at)}
                  </div>
                  <Button
                    type="text"
                    size="small"
                    icon={<HiTrash className="h-4 w-4" />}
                    className="absolute right-2 top-3 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(event) => void deleteSession(event, session.id)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex h-screen min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between bg-[#F5F5F4] px-4">
            <div className="min-w-0 flex-1">
              {sharedHeaderMeta ? (
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className="truncate text-sm font-semibold text-[#1F1F1F]"
                    data-testid={workbenchSelectors.contentPanelTitle}
                  >
                    {sharedHeaderMeta.title}
                  </div>
                  {sharedHeaderMeta.badge ? (
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${sharedHeaderMeta.badgeClassName}`}
                    >
                      {sharedHeaderMeta.badge}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="text"
                size="small"
                icon={
                  contentPanelCollapsed ? (
                    <HiOutlineViewColumns className="h-4 w-4" />
                  ) : (
                    <HiViewColumns className="h-4 w-4" />
                  )
                }
                className={`!flex !h-8 !w-8 !items-center !justify-center !rounded-xl !border !p-0 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:!border-[#D97757] hover:!text-[#D97757] ${
                  contentPanelCollapsed
                    ? '!border-[#E5E5E4] !bg-white/92 !text-[#666666]'
                    : '!border-[#F4E5DF] !bg-[#FBF5F2] !text-[#D97757]'
                }`}
                onClick={() => setContentPanelCollapsed((previous) => !previous)}
              />
              <SettingsMenuButton className="!h-8 !w-8 !rounded-xl !px-0" />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1">
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4" ref={scrollRef}>
                  <div className="mx-auto flex max-w-[860px] flex-col gap-5 pb-8">
                    {currentMessages.length === 0 ? (
                      <div className="relative flex min-h-[58vh] items-center justify-center overflow-hidden px-8 py-12 text-center">
                        <div className="absolute inset-x-[12%] top-[18%] h-44 rounded-full bg-[radial-gradient(circle,rgba(251,245,242,0.98),rgba(251,245,242,0.58)_42%,rgba(245,245,244,0)_76%)] blur-2xl" />
                        <div className="absolute inset-x-[20%] bottom-[20%] h-32 rounded-full bg-[radial-gradient(circle,rgba(244,229,223,0.42),rgba(245,245,244,0)_72%)] blur-3xl" />
                        <div className="relative max-w-[420px]">
                          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/45 text-[#D19A87] shadow-[inset_0_0_0_1px_rgba(228,215,206,0.7)] backdrop-blur-sm">
                            <HiBookOpen className="h-5 w-5" />
                          </div>
                          <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.01em] text-[#2A2826]">
                            从一个问题开始
                          </h3>
                          <p className="mt-2 text-[13px] leading-6 text-[#7C7771]">
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

                <div className="shrink-0 bg-gradient-to-t from-[#F5F5F4] via-[#F5F5F4]/96 via-58% to-transparent px-6 pb-6 pt-6">
                  <div className="mx-auto max-w-[920px]">
                    <WorkbenchComposer
                      mode={composerMode}
                      onModeChange={setComposerMode}
                      modelConfigs={modelConfigs}
                      selectedModelConfigId={selectedModelConfigId}
                      onModelConfigChange={setSelectedModelConfigId}
                      workspaces={workspaces}
                      selectedWorkspaceId={selectedWorkspaceId}
                      onWorkspaceChange={setSelectedWorkspaceId}
                      onDraftChange={handleComposerDraftChange}
                      onSubmit={() => void handleSend()}
                      onCancel={() => void handleCancel()}
                      loading={loading}
                      canSubmit={Boolean(input.trim())}
                      showCancel={loading && composerMode === 'ai' && Boolean(aiRunId)}
                      resetKey={composerResetKey}
                    />

                    {composerMode === 'ai' &&
                    (pendingApprovalRequest || pendingWorkspaceRequest) ? (
                      <div
                        className="mt-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-3 text-sm text-[#8A6510]"
                        data-testid={
                          pendingApprovalRequest
                            ? chatSelectors.approvalBanner
                            : chatSelectors.workspaceBanner
                        }
                      >
                        {pendingApprovalRequest ? (
                          <div className="flex flex-col gap-3">
                            <div>{pendingApprovalRequest.reason}</div>
                            <div className="text-xs text-[#8A6510]">
                              风险级别：{pendingApprovalRequest.riskLevel} ·{' '}
                              {pendingApprovalRequest.command}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="primary"
                                onClick={() => void handleApprovalDecision(true)}
                                loading={approvalSubmitting}
                                data-testid={chatSelectors.approvalApproveButton}
                              >
                                批准执行
                              </Button>
                              <Button
                                onClick={() => void handleApprovalDecision(false)}
                                disabled={approvalSubmitting}
                                data-testid={chatSelectors.approvalDenyButton}
                              >
                                拒绝执行
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {pendingWorkspaceRequest ? (
                          <div className="flex flex-col gap-3">
                            <div>{pendingWorkspaceRequest.reason}</div>
                            <div className="text-xs text-[#8A6510]">
                              请选择当前工作区，必要时再通过 @ 插入目录或文件后继续运行。
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="primary"
                                onClick={() => void handleContinueWithWorkspace()}
                                loading={loading}
                                disabled={!selectedWorkspace}
                                data-testid={chatSelectors.workspaceContinueButton}
                              >
                                继续运行
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {composerMode === 'ai' &&
                    selectedSourceScopes.some(
                      (scope) => scope.sourceType === 'workspace' && scope.hasUnpreparedFiles
                    ) ? (
                      <div
                        className="mt-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2.5 text-sm text-[#8A6510]"
                        data-testid={workbenchSelectors.scopeAiWarning}
                      >
                        已选范围包含未准备的本地文件。AI 可能直接读取原文件，耗时更长，并增加 token
                        消耗。
                      </div>
                    ) : null}

                    {composerMode === 'search' &&
                    selectedSourceScopes.some((scope) => scope.hasUnpreparedFiles) ? (
                      <div
                        className="mt-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2.5 text-sm text-[#8A6510]"
                        data-testid={workbenchSelectors.scopeSearchWarning}
                      >
                        纯搜索只会检索已准备完成的本地资料；未准备文件不会进入候选结果。
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`min-h-0 overflow-hidden transition-[width] duration-200 ${
                contentPanelCollapsed
                  ? 'w-0'
                  : contentPanel.kind === 'review_session'
                    ? 'w-[520px]'
                    : 'w-[430px]'
              }`}
            >
              <WorkbenchContentPanel
                state={
                  contentPanel.kind === 'review_session' && activeDraftReview
                    ? { ...contentPanel, review: activeDraftReview }
                    : contentPanel
                }
                draftReviewLoading={draftReviewLoading}
                draftCommitValidation={draftCommitValidation}
                draftValidationLoading={draftValidationLoading}
                draftDecisionBusyIds={draftDecisionBusyIds}
                draftBulkApplying={draftBulkApplying}
                draftCommitSubmitting={draftCommitSubmitting}
                reviewTurn={reviewTurn}
                onOpenSearchResult={(turn, resultIndex) => void openSearchResult(turn, resultIndex)}
                onOpenReview={openDraftReview}
                onOpenFile={(file) => void openFile(file)}
                onSetDecision={(changeId, decision) =>
                  void handleDraftChangeDecision(changeId, decision)
                }
                onSetAllPending={(decision) => void handleDraftBulkDecision(decision)}
                onRefreshValidation={() => void handleDraftValidationRefresh()}
                onCommit={() => void handleDraftCommit()}
                onOpenPath={openPathOrNotify}
                onRevealPath={revealPathOrNotify}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatPage
