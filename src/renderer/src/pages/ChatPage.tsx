import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  App,
  Input,
  Button,
  Card,
  Collapse,
  Avatar,
  Space,
  Segmented,
  Tooltip
} from 'antd'
import { HiArrowUp, HiPlus, HiTrash, HiUser, HiSparkles, HiBookOpen } from 'react-icons/hi2'
import { LoadingOutlined } from '@ant-design/icons'
import type {
  AiPlanTask,
  AiRunEvent,
  DraftChangeResolution,
  DraftReviewDetail,
  DraftReviewSummary,
  DocumentRecord,
  SearchResult,
  ChatSession,
  ChatMessage,
  JsonValue,
  IpcJsonValue,
  SourceScopeSelection,
  ValidateDraftCommitResponse
} from '../../../shared/types'
import { parseIpcResult } from '../utils/serialization'
import FileRender, { FileRenderDocument } from '../components/fileRenders'
import MarkdownRenderer from '../components/MarkdownRenderer'
import SourceScopeSelect from '../components/SourceScopeSelect'
import AssistantRunCard from '../components/workbench/AssistantRunCard'
import WorkbenchInspectorPanel from '../components/workbench/WorkbenchInspector'
import WorkbenchTimeline from '../components/workbench/WorkbenchTimeline'
import DraftReviewCenter from '../components/draft-review/DraftReviewCenter'
import { chatSelectors, workbenchSelectors } from '../testing/selectors'
import type {
  SearchWorkbenchTurn,
  WorkbenchInspector as WorkbenchInspectorPayload,
  WorkbenchMode
} from '../types/workbench'
import { projectWorkbenchState } from '../utils/workbenchProjection'

const { TextArea } = Input
const { Panel } = Collapse
const isJsdomTestEnv =
  typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''))

type RightPanelState =
  | {
      title: string
      kind: 'chunks'
      data: SearchResult[]
    }
  | {
      title: string
      kind: 'docs'
      data: DocumentRecord[]
    }
  | {
      title: string
      kind: 'json'
      data: AiRunEvent | JsonValue | IpcJsonValue
    }
  | {
      title: string
      kind: 'artifacts'
      data: ArtifactEvent[]
    }

type ActivityEvent = Extract<AiRunEvent, { type: 'activity' }>
type ArtifactEvent = Extract<AiRunEvent, { type: 'file_artifact' }>
type ApprovalRequiredEvent = Extract<AiRunEvent, { type: 'approval_required' }>
type WorkspaceRequiredEvent = Extract<AiRunEvent, { type: 'workspace_required' }>

const getPageNumberFromMetadata = (metadata: SearchResult['metadata']): number => {
  if (!metadata) return 1
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as { page?: number }
      return typeof parsed.page === 'number' ? parsed.page : 1
    } catch {
      return 1
    }
  }
  return typeof metadata.page === 'number' ? metadata.page : 1
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
  const [aiEvents, setAiEvents] = useState<AiRunEvent[]>([])
  const [aiPlan, setAiPlan] = useState<AiPlanTask[]>([])
  const [searchTurn, setSearchTurn] = useState<SearchWorkbenchTurn | null>(null)
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null)
  const [selectedSourceScopes, setSelectedSourceScopes] = useState<SourceScopeSelection[]>([])
  const [draftReviewSummaries, setDraftReviewSummaries] = useState<DraftReviewSummary[]>([])
  const [activeDraftReviewId, setActiveDraftReviewId] = useState<string | null>(null)
  const [activeDraftReview, setActiveDraftReview] = useState<DraftReviewDetail | null>(null)
  const [draftReviewLoading, setDraftReviewLoading] = useState(false)
  const [draftCommitValidation, setDraftCommitValidation] =
    useState<ValidateDraftCommitResponse | null>(null)
  const [draftValidationLoading, setDraftValidationLoading] = useState(false)
  const [draftDecisionBusyIds, setDraftDecisionBusyIds] = useState<string[]>([])
  const [draftBulkApplying, setDraftBulkApplying] = useState(false)
  const [draftCommitSubmitting, setDraftCommitSubmitting] = useState(false)
  const [pendingApprovalRequest, setPendingApprovalRequest] = useState<ApprovalRequiredEvent | null>(
    null
  )
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const [pendingWorkspaceRequest, setPendingWorkspaceRequest] = useState<{
    input: string
    scopes: SourceScopeSelection[]
    reason: string
    request: WorkspaceRequiredEvent
  } | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanelState | null>(null)
  const assistantMsgIdRef = useRef<string | null>(null)
  const lastSubmittedInputRef = useRef('')
  const lastSubmittedScopesRef = useRef<SourceScopeSelection[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Preview state
  const [previewVisible, setPreviewVisible] = useState(false)
  const [currentPreviewDoc, setCurrentPreviewDoc] = useState<SearchResult | null>(null)
  const [currentPreviewFile, setCurrentPreviewFile] = useState<{
    filePath: string
    fileName: string
  } | null>(null)

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

  const projection = useMemo(
    () =>
      projectWorkbenchState({
        aiEvents,
        aiPlan,
        searchTurn
      }),
    [aiEvents, aiPlan, searchTurn]
  )

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }

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

  const resetDraftReviewState = () => {
    setDraftReviewSummaries([])
    setActiveDraftReviewId(null)
    setActiveDraftReview(null)
    setDraftReviewLoading(false)
    setDraftCommitValidation(null)
    setDraftValidationLoading(false)
    setDraftDecisionBusyIds([])
    setDraftBulkApplying(false)
    setDraftCommitSubmitting(false)
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
      setDraftReviewSummaries(nextItems)

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

  const openPathOrNotify = async (filePath: string): Promise<void> => {
    const result = await window.api.openPath(filePath)
    if (!result.success) message.error(result.error || '打开失败')
  }

  const revealPathOrNotify = async (filePath: string): Promise<void> => {
    const result = await window.api.revealPath(filePath)
    if (!result.success) message.error(result.error || '定位失败')
  }

  const loadSessions = async () => {
    try {
      const list = await window.api.chatSessionList()
      setSessions(list)
      if (list.length > 0 && !currentSessionId) {
        setCurrentSessionId(list[0].id)
      } else if (list.length === 0) {
        createNewSession()
      }
    } catch (e) {
      console.error('Failed to load sessions', e)
    }
  }

  const loadMessages = async (sessionId: string) => {
    try {
      const msgs = await window.api.chatMessageList(sessionId)
      setCurrentMessages(msgs)
      scrollToBottom()
    } catch (e) {
      console.error('Failed to load messages', e)
    }
  }

  const createNewSession = async () => {
    try {
      const timestamp = new Date().getTime()
      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title: '新对话',
        created_at: timestamp
      }
      await window.api.chatSessionSave(newSession)
      await loadSessions()
      setCurrentSessionId(newSession.id)
    } catch (e) {
      console.error(e)
      message.error('创建会话失败')
    }
  }

  useEffect(() => {
    loadSessions()
  }, [])

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId)
      setLoading(false)
      setAiRunId(null)
      setAiEvents([])
      setAiPlan([])
      setSearchTurn(null)
      setSelectedTimelineId(null)
      setSelectedSourceScopes([])
      setPendingApprovalRequest(null)
      setApprovalSubmitting(false)
      setPendingWorkspaceRequest(null)
      setRightPanel(null)
      resetDraftReviewState()
      void loadDraftReviewsForSession(currentSessionId)
    } else {
      setCurrentMessages([])
      resetDraftReviewState()
    }
  }, [currentSessionId])

  useEffect(() => {
    scrollToBottom()
  }, [currentMessages])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('workbench-mode-change', { detail: { mode: composerMode } }))
  }, [composerMode])

  useEffect(() => {
    if (projection.timeline.length === 0) {
      if (selectedTimelineId) setSelectedTimelineId(null)
      return
    }
    const exists = projection.timeline.some((item) => item.id === selectedTimelineId)
    if (!exists) {
      setSelectedTimelineId(projection.defaultSelectedId || projection.timeline[0].id)
    }
  }, [projection, selectedTimelineId])

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await window.api.chatSessionDelete(id)
      if (currentSessionId === id) {
        setCurrentSessionId(null)
      }
      await loadSessions()
    } catch (err) {
      console.error(err)
      message.error('删除会话失败')
    }
  }

  useEffect(() => {
    if (!aiRunId) return
    window.api.removeAiRunEventListeners()
    window.api.onAiRunEvent((evt) => {
      if (evt.runId !== aiRunId) return
      setAiEvents((prev) => [...prev, evt])

      if (evt.type === 'tool_call_result') {
        const toolName = evt.toolName
        if (
          toolName === 'kb_hybrid_search_chunks' ||
          toolName === 'kb_vector_search_chunks' ||
          toolName === 'kb_fts_search_chunks'
        ) {
          setRightPanel({
            title: `检索结果 · ${toolName}`,
            kind: 'chunks',
            data: Array.isArray(evt.outputPreview) ? evt.outputPreview : []
          })
          return
        }
        if (toolName === 'kb_list_documents') {
          setRightPanel({
            title: `文档列表 · ${toolName}`,
            kind: 'docs',
            data: Array.isArray(evt.outputPreview) ? evt.outputPreview : []
          })
          return
        }
        setRightPanel({
          title: `工具输出 · ${toolName}`,
          kind: 'json',
          data: evt.outputPreview
        })
        return
      }

      if (
        evt.type === 'terminal_step_started' ||
        evt.type === 'terminal_step_result' ||
        evt.type === 'terminal_step_error'
      ) {
        setRightPanel({
          title: `终端步骤 · ${evt.type}`,
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'human_step') {
        setRightPanel({
          title: `Human 步骤追踪 · ${evt.type}`,
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'watch_hint') {
        setRightPanel({
          title: 'Watch Hint',
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'file_artifact') {
        setRightPanel((prev) => {
          const current =
            prev && prev.kind === 'artifacts' ? (prev.data as ArtifactEvent[]) : []
          const next = [...current, evt].slice(-20)
          return {
            title: '文件产物',
            kind: 'artifacts',
            data: next
          }
        })
        return
      }

      if (evt.type === 'plan_created') {
        if (evt.internal) return
        setAiPlan(evt.plan)
        return
      }

      if (evt.type === 'task_started') {
        if (evt.internal) return
        setAiPlan((prev) =>
          prev.map((t) => (t.id === evt.taskId ? { ...t, status: 'running' } : t))
        )
        return
      }

      if (evt.type === 'task_completed') {
        if (evt.internal) return
        setAiPlan((prev) =>
          prev.map((t) => (t.id === evt.taskId ? { ...t, status: 'completed' } : t))
        )
        return
      }

      if (evt.type === 'task_delivery_ready') {
        if (!evt.internal) {
          setAiPlan((prev) =>
            prev.map((t) =>
              t.id === evt.taskId
                ? {
                    ...t,
                    deliveryMarkdown: evt.deliveryMarkdown
                  }
                : t
            )
          )
        }
        setRightPanel({
          title: `任务交付 · ${evt.taskId}`,
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'workspace_required') {
        if (!evt.internal) {
          setLoading(false)
          setPendingWorkspaceRequest({
            input: lastSubmittedInputRef.current,
            scopes: lastSubmittedScopesRef.current,
            reason: evt.reason,
            request: evt
          })
          message.warning(evt.reason || '执行任务需要先绑定工作区')
        }
        setRightPanel({
          title: '工作区要求',
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'runtime_issue') {
        if (!evt.internal) {
          setLoading(false)
          if (evt.code === 'approval_denied') {
            setPendingApprovalRequest(null)
            setApprovalSubmitting(false)
          }
          const issueMessage =
            evt.code === 'workspace_missing'
              ? '所选工作空间已不存在，请重新选择。'
              : evt.code === 'workspace_path_unavailable'
                ? '所选工作空间路径不可用，请重新扫描或重新配置。'
                : evt.code === 'scope_unavailable'
                  ? '所选资料范围当前不可用，请重新选择。'
                  : evt.code === 'approval_denied'
                    ? '审批未通过，相关操作已停止。'
                    : '当前范围缺少工作空间上下文，请重新选择本地资料范围。'
          message.warning(evt.message || issueMessage)
        }
        setRightPanel({
          title: '运行阻塞原因',
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'approval_required') {
        if (!evt.internal) {
          setLoading(false)
          setApprovalSubmitting(false)
          setPendingApprovalRequest(evt)
          message.info(`命令需要审批：${evt.command}`)
        }
        setRightPanel({
          title: '审批请求',
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'approval_decision') {
        if (evt.internal) return
        setApprovalSubmitting(false)
        setPendingApprovalRequest(null)
        if (evt.approved) {
          setLoading(true)
          message.success('审批已通过')
        } else {
          setLoading(false)
          message.warning(evt.reason || '审批未通过')
        }
        return
      }

      if (evt.type === 'draft_review_ready') {
        if (!evt.internal && currentSessionId) {
          message.success(`草稿审阅已准备完成：${evt.review.changeCount} 处修改`)
          void loadDraftReviewsForSession(currentSessionId, evt.review.reviewId)
        }
        return
      }

      if (evt.type === 'answer_token') {
        const msgId = assistantMsgIdRef.current
        if (!msgId) return
        setCurrentMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, content: (m.content || '') + evt.token } : m))
        )
        scrollToBottom()
        return
      }

      if (evt.type === 'answer_completed') {
        const msgId = assistantMsgIdRef.current
        if (!msgId || !currentSessionId) return
        setCurrentMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, content: evt.text } : m))
        )
        const assistantMsg = {
          id: msgId,
          session_id: currentSessionId,
          role: 'assistant' as const,
          content: evt.text,
          timestamp: Date.now()
        }
        window.api.chatMessageSave(assistantMsg).catch(console.error)
        return
      }

      if (evt.type === 'run_failed') {
        setLoading(false)
        setPendingApprovalRequest(null)
        setApprovalSubmitting(false)
        const msgId = assistantMsgIdRef.current
        if (msgId) {
          setCurrentMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, error: true, content: (m.content || '') + `\n\n[失败] ${evt.error}` }
                : m
            )
          )
        }
        message.error(evt.error || '运行失败')
        return
      }

      if (evt.type === 'run_cancelled') {
        setLoading(false)
        setPendingApprovalRequest(null)
        setApprovalSubmitting(false)
        message.info('已取消')
        return
      }

      if (evt.type === 'run_completed') {
        setLoading(false)
        setPendingApprovalRequest(null)
        setApprovalSubmitting(false)
      }
    })
    return () => {
      window.api.removeAiRunEventListeners()
    }
  }, [aiRunId, currentSessionId])

  const handleSend = async () => {
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
    setSelectedTimelineId(null)
    setAiEvents([])
    setAiPlan([])
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingWorkspaceRequest(null)
    setRightPanel(null)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = userQuery
    lastSubmittedScopesRef.current = selectedSourceScopes

    // 1. Create User Message
    const timestamp = new Date().getTime()
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp,
      sources: undefined,
      error: false
    }

    const newMessages = [...currentMessages, userMsg]
    setCurrentMessages(newMessages)
    // Save user message async
    window.api.chatMessageSave(userMsg).catch(console.error)

    await updateSessionTitleIfNeeded(userQuery)

    try {
      const assistantMsgId = crypto.randomUUID()
      assistantMsgIdRef.current = assistantMsgId
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        session_id: currentSessionId,
        role: 'assistant',
        content: '',
        timestamp: Date.now()
      }
      setCurrentMessages((prev) => [...prev, assistantMsg])

      const res = await window.api.aiRunStart({
        sessionId: currentSessionId,
        input: userQuery,
        selectedSourceScopes: selectedSourceScopes.length > 0 ? selectedSourceScopes : undefined,
        allowNonLocal: false
      })
      if (!res.success || !res.runId) {
        setLoading(false)
        message.error(res.error || '启动失败')
        return
      }
      setAiRunId(res.runId)

      // 2. Optional quick inline context for preview (no impact on model execution)
      try {
        const s = await window.api.search(userQuery)
        const parsed = s.results.map(parseIpcResult)
        const unique: SearchResult[] = []
        const seenIds = new Set<string>()
        for (const r of parsed) {
          if (r.document_id && !seenIds.has(r.document_id)) {
            seenIds.add(r.document_id)
            unique.push(r)
          }
        }
        userMsg.sources = JSON.stringify(unique.slice(0, 5))
        setCurrentMessages((prev) => prev.map((m) => (m.id === userMsg.id ? userMsg : m)))
        window.api.chatMessageSave(userMsg).catch(console.error)
      } catch (e) {
        void e
      }
    } catch (e) {
      console.error(e)
      setLoading(false)
      message.error('发送失败')
    }
  }

  const updateSessionTitleIfNeeded = async (userQuery: string): Promise<void> => {
    if (!currentSessionId || currentMessages.length !== 0) return
    const session = sessions.find((item) => item.id === currentSessionId)
    if (!session) return
    await window.api.chatSessionSave({ ...session, title: userQuery.slice(0, 20) })
    await loadSessions()
  }

  const handleSearchSend = async () => {
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
    setAiEvents([])
    setAiPlan([])
    setSearchTurn(null)
    setSelectedTimelineId(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingWorkspaceRequest(null)
    setRightPanel(null)
    assistantMsgIdRef.current = null

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: userQuery,
      timestamp: Date.now()
    }
    setCurrentMessages((prev) => [...prev, userMsg])
    window.api.chatMessageSave(userMsg).catch(console.error)

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
          ? `已从本地资料中找到 ${results.length} 条结果，右侧可查看详情。`
          : '未在当前本地资料范围中找到匹配结果。'
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        session_id: currentSessionId,
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now()
      }
      setCurrentMessages((prev) => [...prev, assistantMsg])
      window.api.chatMessageSave(assistantMsg).catch(console.error)

      const nextTurn: SearchWorkbenchTurn = {
        query: userQuery,
        results,
        tokens: response.tokens,
        createdAt: Date.now()
      }
      setSearchTurn(nextTurn)
      setRightPanel({
        title: '搜索结果',
        kind: 'chunks',
        data: results
      })
    } catch (error) {
      console.error(error)
      message.error('搜索失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!aiRunId) return
    try {
      const res = await window.api.aiRunCancel(aiRunId)
      if (!res.success) message.error(res.error || '取消失败')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败')
    }
  }

  const handleApprovalDecision = async (approved: boolean) => {
    if (!pendingApprovalRequest || approvalSubmitting) return
    setApprovalSubmitting(true)
    try {
      const res = await window.api.aiRunApprovalDecide({
        runId: pendingApprovalRequest.runId,
        approvalId: pendingApprovalRequest.approvalId,
        approved,
        reason: approved ? 'approved_in_chat_ui' : 'denied_in_chat_ui'
      })
      if (!res.success) {
        setApprovalSubmitting(false)
        message.error(res.error || '审批提交失败')
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

  const handleContinueWithWorkspace = async () => {
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
    setCurrentMessages((prev) => [...prev, continueMessage])
    window.api.chatMessageSave(continueMessage).catch(console.error)

    setLoading(true)
    setAiEvents([])
    setAiPlan([])
    setSearchTurn(null)
    setSelectedTimelineId(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setRightPanel(null)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = pendingWorkspaceRequest.input
    lastSubmittedScopesRef.current = selectedSourceScopes

    try {
      const assistantMsgId = crypto.randomUUID()
      assistantMsgIdRef.current = assistantMsgId
      setCurrentMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          session_id: currentSessionId,
          role: 'assistant',
          content: '',
          timestamp: Date.now()
        }
      ])

      const res = await window.api.aiRunStart({
        sessionId: currentSessionId,
        input: pendingWorkspaceRequest.input,
        selectedSourceScopes: selectedSourceScopes.length > 0 ? selectedSourceScopes : undefined,
        allowNonLocal: false
      })
      if (!res.success || !res.runId) {
        setLoading(false)
        message.error(res.error || '继续运行失败')
        return
      }
      setPendingWorkspaceRequest(null)
      setAiRunId(res.runId)
    } catch (error) {
      console.error(error)
      setLoading(false)
      message.error('继续运行失败')
    }
  }

  const handleSelectDraftReview = async (reviewId: string): Promise<void> => {
    try {
      await loadDraftReviewDetail(reviewId)
    } catch (error) {
      console.error(error)
      message.error('加载草稿审阅失败')
    }
  }

  const handleOpenDraftReview = (reviewId: string): void => {
    void handleSelectDraftReview(reviewId)
  }

  const handleDraftChangeDecision = async (
    changeId: string,
    decision: DraftChangeResolution
  ): Promise<void> => {
    if (!activeDraftReview || !currentSessionId) return
    setDraftDecisionBusyIds((prev) => [...prev, changeId])
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
      setDraftDecisionBusyIds((prev) => prev.filter((item) => item !== changeId))
    }
  }

  const handleDraftBulkDecision = async (decision: DraftChangeResolution): Promise<void> => {
    if (!activeDraftReview || !currentSessionId || draftBulkApplying) return
    const pendingChanges = activeDraftReview.changes.filter((change) => change.decision === 'pending')
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

  const renderTrace = () => {
    return null
  }

  const renderAssistantRunCard = () => {
    if (composerMode !== 'ai' || (!aiRunId && aiPlan.length === 0 && aiEvents.length === 0)) {
      return null
    }
    const answerPreview =
      [...currentMessages].reverse().find((messageItem) => messageItem.role === 'assistant')?.content ||
      undefined

    return (
      <AssistantRunCard
        runId={aiRunId}
        plan={aiPlan}
        events={aiEvents}
        answerPreview={answerPreview}
        onOpenReview={handleOpenDraftReview}
      />
    )
  }

  const renderActivityFeed = () => {
    const activities = aiEvents.filter((e) => e.type === 'activity') as ActivityEvent[]
    if (activities.length === 0) return null

    return (
      <div className="mb-4 border border-[#E5E5E4] rounded-xl bg-white p-3">
        <div className="text-xs font-medium text-[#666666] mb-2">AI 活动</div>
        <div className="flex flex-col gap-2">
          {activities.slice(-8).map((a, idx) => (
            <div key={`${a.activityId || idx}-${idx}`} className="text-xs text-[#666666]">
              <span className="text-[#999999] mr-2">{a.status}</span>
              <span>{a.summary}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const fallbackInspector: WorkbenchInspectorPayload = rightPanel
    ? rightPanel.kind === 'chunks'
      ? {
          kind: 'search_results',
          title: rightPanel.title,
          query: rightPanel.title,
          results: rightPanel.data,
          tokens: searchTurn?.tokens || []
        }
      : rightPanel.kind === 'docs'
        ? {
            kind: 'docs',
            title: rightPanel.title,
            data: rightPanel.data
          }
        : rightPanel.kind === 'artifacts'
          ? rightPanel.data.length > 0
            ? {
                kind: 'artifact',
                title: rightPanel.title,
                event: rightPanel.data[rightPanel.data.length - 1],
                related: rightPanel.data
              }
            : {
                kind: 'empty',
                title: rightPanel.title,
                description: '当前没有可展示的文件产物。'
              }
          : {
              kind: 'json',
              title: rightPanel.title,
              data: rightPanel.data
            }
    : {
        kind: 'empty',
        title: '检查器',
        description:
          composerMode === 'search'
            ? '发送一次本地搜索后，在这里查看结果。'
            : '发送一次 AI 运行后，在这里查看计划、步骤和产物。'
      }

  const selectedTimelineItem =
    projection.timeline.find((item) => item.id === selectedTimelineId) || null
  const activeInspector = selectedTimelineItem?.inspector || fallbackInspector

  const renderRightPanel = () => {
    return (
      <div
        className="w-[380px] border-l border-[#E5E5E4] bg-[#F5F5F4] flex flex-col h-full"
      >
        <div className="space-y-4 p-4">
          <WorkbenchTimeline
            items={projection.timeline}
            selectedId={selectedTimelineId}
            mode={composerMode}
            onSelect={setSelectedTimelineId}
          />
          <WorkbenchInspectorPanel
            inspector={activeInspector}
            runId={aiRunId}
            onOpenSearchResult={(result) => void openPreview(result)}
            onOpenArtifactPreview={(artifactPath, fileName) => {
              setCurrentPreviewDoc(null)
              setCurrentPreviewFile({
                filePath: artifactPath,
                fileName
              })
              setPreviewVisible(true)
            }}
            onOpenReview={handleOpenDraftReview}
            onOpenPath={openPathOrNotify}
            onRevealPath={revealPathOrNotify}
          />
        </div>
      </div>
    )
  }

  const openPreview = async (item: SearchResult) => {
    if (item.source_type === 'web') {
      const url = item.document?.file_path
      if (!url) {
        message.warning('未找到网页链接')
        return
      }
      const res = await window.api.openExternal(url)
      if (!res.success) {
        message.error(res.error || '打开链接失败')
      }
      return
    }
    setCurrentPreviewDoc(item)
    setCurrentPreviewFile(null)
    setPreviewVisible(true)
  }

  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === 'user'
    let sources: SearchResult[] = []
    try {
      if (msg.sources) {
        sources = JSON.parse(msg.sources)
      }
    } catch (e) {
      console.warn('Failed to parse sources', e)
    }

    return (
      <div key={msg.id} className={`flex gap-4 mb-6 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <Avatar
          icon={isUser ? <HiUser /> : <HiSparkles />}
          className={`flex-shrink-0 flex items-center justify-center ${
            isUser ? 'bg-[#E5E5E4] text-[#1F1F1F]' : '!bg-[#FFF0E6] !text-[#D97757]'
          }`}
        />
        <div className={`flex flex-col max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
          <div
            className={`rounded-2xl px-5 py-3 shadow-sm text-[15px] leading-relaxed border ${
              isUser
                ? 'bg-white border-[#E5E5E4] text-[#1F1F1F] rounded-br-sm whitespace-pre-wrap'
                : 'bg-[#FBF5F2] border-[#F4E5DF] text-[#1F1F1F] rounded-bl-sm w-full'
            }`}
          >
            {isUser ? (
              msg.content
            ) : (
              <MarkdownRenderer
                content={msg.content || (loading && msg.role === 'assistant' ? '...' : '')}
              />
            )}
            {loading && msg.role === 'assistant' && !msg.content && <LoadingOutlined />}
          </div>

          {/* Sources for User Message */}
          {isUser && sources && sources.length > 0 && (
            <Collapse
              ghost
              size="small"
              className="mt-2 w-full max-w-lg [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-content-box]:!px-0"
            >
              <Panel
                header={
                  <Space className="text-xs text-[#999999]">
                    <HiBookOpen />
                    <span>参考了 {sources.length} 个文档</span>
                  </Space>
                }
                key="1"
              >
                <div className="flex flex-row overflow-x-auto gap-3 pb-2">
                  {sources.map((source, idx) => (
                    <Card
                      key={idx}
                      size="small"
                      className="flex-shrink-0 w-48 bg-[#F5F5F4] border-[#E5E5E4] cursor-pointer hover:border-[#D97757] transition-colors"
                      onClick={() => openPreview(source)}
                    >
                      <div
                        className="text-xs font-bold text-[#666666] mb-1 truncate"
                        title={source.document_name}
                      >
                        {idx + 1}. {source.document_name}
                      </div>
                      <div className="text-xs text-[#999999] line-clamp-2 h-8">{source.text}</div>
                    </Card>
                  ))}
                </div>
              </Panel>
            </Collapse>
          )}
        </div>
      </div>
    )
  }

  const previewDocuments: FileRenderDocument[] = currentPreviewFile
    ? [
        {
          uri: '',
          filePath: currentPreviewFile.filePath,
          fileName: currentPreviewFile.fileName
        }
      ]
    : currentPreviewDoc && currentPreviewDoc.document?.file_path
      ? [
          {
            uri: '', // Will be generated from filePath
            filePath: currentPreviewDoc.document.file_path,
            fileName: currentPreviewDoc.document_name,
            metadata: {
              pageNumber: getPageNumberFromMetadata(currentPreviewDoc.metadata)
            }
          }
        ]
      : []

  return (
    <div
      className="flex h-full bg-[#F5F5F4]"
      data-testid={workbenchSelectors.page}
      data-workbench-mode={composerMode}
    >
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-[#E5E5E4] flex flex-col h-[calc(100vh-64px)]">
        <div className="p-4 border-b border-[#E5E5E4] flex items-center justify-between">
          <span className="font-semibold text-[#1F1F1F]">历史记录</span>
          <Button
            type="text"
            icon={<HiPlus />}
            className="text-[#D97757] hover:text-[#C66A4A] hover:bg-[#FBF5F2]"
            onClick={createNewSession}
          />
        </div>
        <div className="flex-1 overflow-y-auto" data-testid={workbenchSelectors.sessionsList}>
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`p-3 cursor-pointer border-b border-[#F5F5F4] transition-colors group relative ${
                currentSessionId === session.id
                  ? 'bg-[#FBF5F2] border-l-4 border-l-[#D97757]'
                  : 'hover:bg-[#F5F5F4] border-l-4 border-l-transparent'
              }`}
              onClick={() => setCurrentSessionId(session.id)}
            >
              <div className="text-sm font-medium text-[#1F1F1F] truncate pr-6">
                {session.title}
              </div>
              <div className="text-xs text-[#999999] mt-1">
                {new Date(session.created_at).toLocaleDateString()}
              </div>
              <Button
                type="text"
                size="small"
                icon={<HiTrash />}
                className="absolute right-2 top-3 text-[#999999] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => deleteSession(e, session.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-[calc(100vh-64px)] relative">
        {renderAssistantRunCard()}
        {draftReviewSummaries.length > 0 || draftReviewLoading ? (
          <DraftReviewCenter
            reviews={draftReviewSummaries}
            activeReviewId={activeDraftReviewId}
            activeReview={activeDraftReview}
            loading={draftReviewLoading}
            validation={draftCommitValidation}
            validating={draftValidationLoading}
            busyChangeIds={draftDecisionBusyIds}
            bulkApplying={draftBulkApplying}
            committing={draftCommitSubmitting}
            onSelectReview={(reviewId) => void handleSelectDraftReview(reviewId)}
            onSetDecision={(changeId, decision) => void handleDraftChangeDecision(changeId, decision)}
            onSetAllPending={(decision) => void handleDraftBulkDecision(decision)}
            onRefreshValidation={() => void handleDraftValidationRefresh()}
            onCommit={() => void handleDraftCommit()}
            onOpenPreview={(filePath, fileName) => {
              setCurrentPreviewDoc(null)
              setCurrentPreviewFile({ filePath, fileName })
              setPreviewVisible(true)
            }}
            onOpenPath={openPathOrNotify}
            onRevealPath={revealPathOrNotify}
          />
        ) : null}
        {composerMode === 'ai' ? renderTrace() : null}

        <div className="flex-1 min-h-0 flex">
          {/* Messages */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6 pb-32" ref={scrollRef}>
            {renderActivityFeed()}
            {currentMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[#999999] gap-4">
                <div className="w-16 h-16 bg-[#F5F5F4] rounded-full flex items-center justify-center">
                  <HiSparkles className="w-8 h-8 text-[#D97757]" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-[#1F1F1F] mb-2">有什么可以帮您？</h3>
                  <p>
                    {composerMode === 'search'
                      ? '纯搜索模式只检索本地资料，不调用大模型。'
                      : '你可以直接提问，系统会执行计划并展示过程。'}
                  </p>
                </div>
              </div>
            ) : (
              currentMessages.map(renderMessage)
            )}
          </div>

          {renderRightPanel()}
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F5F5F4] via-[#F5F5F4] to-transparent">
          <div className="bg-white border border-[#E5E5E4] rounded-2xl shadow-lg p-3 focus-within:ring-4 focus-within:ring-[#F4E5DF] focus-within:border-[#D97757] transition-all duration-300">
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                composerMode === 'search'
                  ? '输入要搜索的内容...'
                  : '输入问题，AI 会规划并执行任务...'
              }
              autoSize={isJsdomTestEnv ? undefined : { minRows: 1, maxRows: 6 }}
              variant="borderless"
              className="text-[15px] mb-2"
              data-testid={workbenchSelectors.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <div className="grid grid-cols-12 gap-2 mb-2">
              <div className="col-span-12 sm:col-span-4">
                <Segmented
                  value={composerMode}
                  onChange={(value) => setComposerMode(value as WorkbenchMode)}
                  options={[
                    { label: 'AI 对话', value: 'ai' },
                    { label: '纯搜索', value: 'search' }
                  ]}
                  className="w-full bg-[#F5F5F4]"
                  data-testid={workbenchSelectors.modeSwitch}
                />
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
            {composerMode === 'ai' &&
              (pendingApprovalRequest ||
                pendingWorkspaceRequest) && (
              <div
                className={`mb-3 rounded-2xl border px-3 py-3 text-sm ${
                  pendingApprovalRequest || pendingWorkspaceRequest
                    ? 'border-[#FDECC8] bg-[#FFF9ED] text-[#8A6510]'
                    : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]'
                }`}
                data-testid={
                  pendingApprovalRequest
                    ? chatSelectors.approvalBanner
                    : pendingWorkspaceRequest
                      ? chatSelectors.workspaceBanner
                      : chatSelectors.workspaceBanner
                }
              >
                {pendingApprovalRequest && (
                  <div className="mt-2 flex flex-col gap-3">
                    <div>{pendingApprovalRequest.reason}</div>
                    <div className="text-xs text-[#8A6510]">
                      风险级别：{pendingApprovalRequest.riskLevel} · {pendingApprovalRequest.command}
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
                )}
                {pendingWorkspaceRequest && (
                  <div className="mt-2 flex flex-col gap-3">
                    <div>{pendingWorkspaceRequest.reason}</div>
                    <div className="text-xs text-[#8A6510]">
                      请先通过 @ 选择工作空间、目录或文件范围，再继续运行。
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="primary"
                        onClick={() => void handleContinueWithWorkspace()}
                        loading={loading}
                        disabled={!selectedSourceScopes.some((scope) => scope.workspace?.rootPath)}
                        data-testid={chatSelectors.workspaceContinueButton}
                      >
                        继续运行
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {composerMode === 'ai' &&
              selectedSourceScopes.some(
                (scope) => scope.sourceType === 'workspace' && scope.hasUnpreparedFiles
              ) && (
              <div className="mb-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2 text-sm text-[#8A6510]">
                已选范围包含未准备的本地文件。AI 可能直接读取原文件，耗时更长，并增加 token 消耗。
              </div>
            )}
            {composerMode === 'search' &&
              selectedSourceScopes.some((scope) => scope.hasUnpreparedFiles) && (
                <div className="mb-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2 text-sm text-[#8A6510]">
                  纯搜索只会检索已准备完成的本地资料；未准备文件不会进入候选结果。
                </div>
              )}
            <div className="flex justify-between items-center">
              <div className="text-xs text-[#999999] flex items-center gap-2">
                {composerMode === 'ai' ? (
                  <>
                    <Tooltip title="由主进程执行计划并返回事件流">
                      <span className="flex items-center gap-1 bg-[#F5F5F4] px-2 py-1 rounded cursor-help">
                        <HiBookOpen className="text-[#D97757]" />
                        <span>AI Runner</span>
                      </span>
                    </Tooltip>
                    <Tooltip title="@ 只是在告诉 AI 优先参考哪些资料，不代表回答只能来自这些资料。">
                      <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[#666666]">
                        优先参考范围
                      </span>
                    </Tooltip>
                  </>
                ) : (
                  <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[#666666]">
                    仅搜索本地资料
                  </span>
                )}
                {selectedSourceScopes.length > 0 && (
                  <span className="rounded-full bg-[#FBF5F2] px-2 py-1 text-[#D97757]">
                    已选 {selectedSourceScopes.length} 个{composerMode === 'ai' ? '参考范围' : '搜索范围'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {loading && composerMode === 'ai' && aiRunId && (
                  <Button
                    onClick={handleCancel}
                    className="border-[#E5E5E4]"
                    data-testid={workbenchSelectors.cancelButton}
                  >
                    取消
                  </Button>
                )}
                <Button
                  type="primary"
                  shape="circle"
                  icon={<HiArrowUp />}
                  onClick={handleSend}
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

      <FileRender
        open={previewVisible}
        documents={previewDocuments}
        onCancel={() => setPreviewVisible(false)}
      />
    </div>
  )
}

export default ChatPage
