import React, { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Input, Tooltip } from 'antd'
import { HiArrowUp, HiBars3, HiPlus, HiTrash, HiUser, HiBookOpen } from 'react-icons/hi2'
import type {
  AiRunEvent,
  ChatMessage,
  ChatSession,
  DraftChangeResolution,
  DraftReviewDetail,
  DraftReviewSummary,
  SearchResult,
  SourceScopeSelection,
  ValidateDraftCommitResponse
} from '../../../shared/types'
import { parseIpcResult } from '../utils/serialization'
import MarkdownRenderer from '../components/MarkdownRenderer'
import SourceScopeSelect from '../components/SourceScopeSelect'
import AssistantTurnCard from '../components/workbench/AssistantTurnCard'
import WorkbenchContentPanel from '../components/workbench/WorkbenchContentPanel'
import { WORKBENCH_SIDEBAR_STORAGE_KEY } from '../components/workbench/constants'
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

const { TextArea } = Input

const isJsdomTestEnv =
  typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''))

type ApprovalRequiredEvent = Extract<AiRunEvent, { type: 'approval_required' }>
type WorkspaceRequiredEvent = Extract<AiRunEvent, { type: 'workspace_required' }>

const createEmptyPanel = (description: string, title = '内容面板'): WorkbenchContentPanelState => ({
  kind: 'empty',
  title,
  description
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
  const [assistantTurns, setAssistantTurns] = useState<Record<string, AssistantTurnViewModel>>({})
  const [contentPanel, setContentPanel] = useState<WorkbenchContentPanelState>(
    createEmptyPanel('从对话中的步骤、文件或搜索结果进入这里。')
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(WORKBENCH_SIDEBAR_STORAGE_KEY)
    return stored === 'true'
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
      setContentPanel({
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
  }, [])

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    if (currentSessionId) {
      void loadMessages(currentSessionId)
      setLoading(false)
      setAiRunId(null)
      setSearchTurn(null)
      setSelectedSourceScopes([])
      setPendingApprovalRequest(null)
      setApprovalSubmitting(false)
      setPendingWorkspaceRequest(null)
      setAssistantTurns({})
      setContentPanel(createEmptyPanel('从对话中的步骤、文件或搜索结果进入这里。'))
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

    setContentPanel({
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
    setContentPanel({
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
          setContentPanel({
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
    const hasWorkspaceBinding = selectedSourceScopes.some((scope) => scope.workspace?.rootPath)
    if (likelyExecutable && !hasWorkspaceBinding) {
      message.warning('该请求可能触发本地执行，请先通过 @ 选择工作空间、目录或文件范围')
      return
    }

    setInput('')
    setLoading(true)
    setSearchTurn(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingWorkspaceRequest(null)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = userQuery
    lastSubmittedScopesRef.current = selectedSourceScopes
    setContentPanel(createEmptyPanel('运行中的文件、搜索结果和待确认修改会显示在这里。'))

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
        const searchResponse = await window.api.search(userQuery)
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
    setLoading(true)
    setAiRunId(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingWorkspaceRequest(null)
    setContentPanel(createEmptyPanel('搜索结果会显示在这里。'))

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
          ? `已在当前本地资料范围中找到 ${results.length} 条结果，右侧可以直接查看命中详情。`
          : '未在当前本地资料范围中找到匹配结果。'
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
      setContentPanel({
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
    const hasWorkspaceBinding = selectedSourceScopes.some((scope) => scope.workspace?.rootPath)
    if (!hasWorkspaceBinding) {
      message.warning('请先通过 @ 选择工作空间、目录或文件范围后再继续')
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
      <div key={messageItem.id} className="flex flex-row-reverse gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-[#1F1F1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <HiUser className="h-5 w-5" />
        </div>
        <div className="max-w-[80%]">
          <div className="rounded-[24px] rounded-br-[10px] border border-[#E5E5E4] bg-white px-5 py-4 text-[15px] leading-relaxed text-[#1F1F1F] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            {messageItem.content}
          </div>
          {sources.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {sources.map((source) => {
                const fileRef = getSearchResultFileRef(source)
                if (!fileRef) return null
                return (
                  <button
                    key={`${messageItem.id}-${source.id}`}
                    type="button"
                    onClick={() => void openFile(fileRef)}
                    className="rounded-full border border-[#E5E5E4] bg-white px-3 py-1.5 text-xs text-[#666666] transition-all duration-200 hover:border-[#D97757] hover:text-[#D97757]"
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
        <div key={messageItem.id} className="flex gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[#FBF5F2] text-[#D97757]">
            <HiBookOpen className="h-5 w-5" />
          </div>
          <div className="max-w-[80%] rounded-[24px] rounded-bl-[10px] border border-[#F4E5DF] bg-[#FBF5F2] px-5 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
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
            setContentPanel({
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

  return (
    <div
      className="flex h-full bg-[#F5F5F4]"
      data-testid={workbenchSelectors.page}
      data-workbench-mode={composerMode}
    >
      <aside
        className={`flex h-[calc(100vh-64px)] flex-col border-r border-[#E5E5E4] bg-white transition-all duration-200 ${
          sidebarCollapsed ? 'w-14' : 'w-[232px]'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#E5E5E4] px-3 py-4">
          {!sidebarCollapsed ? (
            <span className="text-sm font-semibold text-[#1F1F1F]">对话</span>
          ) : null}
          <div className="flex items-center gap-1">
            <Button
              type="text"
              size="small"
              icon={<HiPlus className="h-4 w-4" />}
              className="text-[#D97757] hover:text-[#C66A4A] hover:bg-[#FBF5F2]"
              onClick={() => void createNewSession()}
            />
            <Button
              type="text"
              size="small"
              icon={<HiBars3 className="h-4 w-4" />}
              onClick={() => setSidebarCollapsed((previous) => !previous)}
              data-testid={workbenchSelectors.sessionsToggle}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" data-testid={workbenchSelectors.sessionsList}>
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`group relative cursor-pointer border-b border-[#F5F5F4] transition-colors ${
                currentSessionId === session.id
                  ? 'bg-[#FBF5F2] border-l-4 border-l-[#D97757]'
                  : 'border-l-4 border-l-transparent hover:bg-[#F5F5F4]'
              } ${sidebarCollapsed ? 'px-2 py-3' : 'px-3 py-3'}`}
              onClick={() => setCurrentSessionId(session.id)}
            >
              {sidebarCollapsed ? (
                <div className="flex justify-center text-xs font-medium text-[#1F1F1F]">
                  {session.title.slice(0, 1)}
                </div>
              ) : (
                <>
                  <div className="truncate pr-6 text-sm font-medium text-[#1F1F1F]">
                    {session.title}
                  </div>
                  <div className="mt-1 text-xs text-[#999999]">
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

      <div className="min-w-0 flex-1 border-r border-[#E5E5E4]">
        <div className="relative flex h-[calc(100vh-64px)] flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-40 pt-6" ref={scrollRef}>
            <div className="mx-auto flex max-w-[820px] flex-col gap-6">
              {currentMessages.length === 0 ? (
                <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed border-[#E5E5E4] bg-white/50 px-8 py-10 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FBF5F2] text-[#D97757]">
                    <HiBookOpen className="h-8 w-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-[#1F1F1F]">从一个问题开始</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#666666]">
                      {composerMode === 'search'
                        ? '纯搜索模式只检索当前本地资料范围，不调用大模型。'
                        : 'AI 会在当前范围内执行任务，并把步骤、文件和待确认修改整理到右侧。'}
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

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#F5F5F4] via-[#F5F5F4] to-transparent px-6 pb-6 pt-12">
            <div className="mx-auto max-w-[860px] rounded-[28px] border border-[#E5E5E4] bg-white px-4 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition-all duration-200 focus-within:border-[#D97757] focus-within:ring-4 focus-within:ring-[#F4E5DF]">
              <TextArea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  composerMode === 'search'
                    ? '输入要搜索的内容...'
                    : '输入问题，AI 会整理步骤、文件和待确认修改...'
                }
                autoSize={isJsdomTestEnv ? undefined : { minRows: 1, maxRows: 6 }}
                variant="borderless"
                className="mb-3 text-[15px]"
                data-testid={workbenchSelectors.input}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
              />

              <div className="mb-3 grid grid-cols-12 gap-2">
                <div className="col-span-12 sm:col-span-4">
                  <div
                    className="grid grid-cols-2 rounded-2xl bg-[#F5F5F4] p-1"
                    data-testid={workbenchSelectors.modeSwitch}
                  >
                    {[
                      { key: 'ai', label: 'AI 对话' },
                      { key: 'search', label: '纯搜索' }
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setComposerMode(item.key as WorkbenchMode)}
                        className={`rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                          composerMode === item.key
                            ? 'bg-white text-[#1F1F1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                            : 'text-[#666666]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className="col-span-12 sm:col-span-8"
                  data-testid={workbenchSelectors.sourceScopeField}
                >
                  <SourceScopeSelect
                    mode={composerMode === 'ai' ? 'chat' : 'search'}
                    value={selectedSourceScopes}
                    onChange={setSelectedSourceScopes}
                    placeholder={
                      composerMode === 'ai'
                        ? '输入 @ 选择优先参考的工作空间、目录、文件或网页资料（可选）'
                        : '输入 @ 锁定搜索范围，只搜索已准备的本地资料'
                    }
                    className="w-full"
                  />
                </div>
              </div>

              {composerMode === 'ai' && (pendingApprovalRequest || pendingWorkspaceRequest) ? (
                <div
                  className="mb-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-3 text-sm text-[#8A6510]"
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
                        请先通过 @ 选择工作空间、目录或文件范围，再继续运行。
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="primary"
                          onClick={() => void handleContinueWithWorkspace()}
                          loading={loading}
                          disabled={
                            !selectedSourceScopes.some((scope) => scope.workspace?.rootPath)
                          }
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
                  className="mb-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2 text-sm text-[#8A6510]"
                  data-testid={workbenchSelectors.scopeAiWarning}
                >
                  已选范围包含未准备的本地文件。AI 可能直接读取原文件，耗时更长，并增加 token 消耗。
                </div>
              ) : null}

              {composerMode === 'search' &&
              selectedSourceScopes.some((scope) => scope.hasUnpreparedFiles) ? (
                <div
                  className="mb-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2 text-sm text-[#8A6510]"
                  data-testid={workbenchSelectors.scopeSearchWarning}
                >
                  纯搜索只会检索已准备完成的本地资料；未准备文件不会进入候选结果。
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#999999]">
                  {composerMode === 'ai' ? (
                    <>
                      <Tooltip title="由主进程执行计划并回传步骤、文件与待确认修改。">
                        <span className="flex items-center gap-1 rounded-full bg-[#F5F5F4] px-2 py-1">
                          <HiBookOpen className="text-[#D97757]" />
                          <span>AI Runner</span>
                        </span>
                      </Tooltip>
                      <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[#666666]">
                        优先参考范围
                      </span>
                    </>
                  ) : (
                    <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[#666666]">
                      仅搜索本地资料
                    </span>
                  )}
                  {selectedSourceScopes.length > 0 ? (
                    <span className="rounded-full bg-[#FBF5F2] px-2 py-1 text-[#D97757]">
                      已选 {selectedSourceScopes.length} 个
                      {composerMode === 'ai' ? '参考范围' : '搜索范围'}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  {loading && composerMode === 'ai' && aiRunId ? (
                    <Button
                      onClick={() => void handleCancel()}
                      className="border-[#E5E5E4]"
                      data-testid={workbenchSelectors.cancelButton}
                    >
                      取消
                    </Button>
                  ) : null}
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<HiArrowUp className="h-4 w-4" />}
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || loading}
                    loading={loading}
                    className={`${input.trim() ? '!bg-[#D97757]' : '!bg-[#E5E5E4] !text-white'} border-none shadow-none`}
                    data-testid={workbenchSelectors.sendButton}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={contentPanel.kind === 'review_session' ? 'w-[560px]' : 'w-[460px]'}>
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
          onClose={() =>
            setContentPanel(createEmptyPanel('从对话中的步骤、文件或搜索结果进入这里。'))
          }
          onOpenSearchResult={(turn, resultIndex) => void openSearchResult(turn, resultIndex)}
          onOpenReview={openDraftReview}
          onOpenFile={(file) => void openFile(file)}
          onSetDecision={(changeId, decision) => void handleDraftChangeDecision(changeId, decision)}
          onSetAllPending={(decision) => void handleDraftBulkDecision(decision)}
          onRefreshValidation={() => void handleDraftValidationRefresh()}
          onCommit={() => void handleDraftCommit()}
          onOpenPath={openPathOrNotify}
          onRevealPath={revealPathOrNotify}
        />
      </div>
    </div>
  )
}

export default ChatPage
