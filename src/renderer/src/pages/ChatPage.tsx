import React, { useState, useEffect, useRef } from 'react'
import { Input, Button, Card, message, Collapse, Avatar, Tooltip, Space, Progress } from 'antd'
import { HiArrowUp, HiPlus, HiTrash, HiUser, HiSparkles, HiBookOpen } from 'react-icons/hi2'
import { LoadingOutlined } from '@ant-design/icons'
import type {
  AiPlanTask,
  AiRunEvent,
  DocumentRecord,
  SearchResult,
  ChatSession,
  ChatMessage,
  JsonValue,
  IpcJsonValue,
  SourceScopeSelection
} from '../../../shared/types'
import { groupArtifactEventsByTask } from '../../../shared/aiRunEventUtils'
import { parseIpcResult } from '../utils/serialization'
import FileRender, { FileRenderDocument } from '../components/fileRenders'
import MarkdownRenderer from '../components/MarkdownRenderer'
import SourceScopeSelect from '../components/SourceScopeSelect'
import { chatSelectors } from '../testing/selectors'

const { TextArea } = Input
const { Panel } = Collapse

const extractAbsolutePaths = (text: string): string[] => {
  const matches = String(text || '').match(/\/[^\s"'`;]+/g) || []
  const unique = Array.from(new Set(matches.map((v) => v.trim()).filter(Boolean)))
  return unique.slice(0, 5)
}

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

type ToolCallEvent = Extract<AiRunEvent, { type: 'tool_call_started' | 'tool_call_result' }>
type TerminalEvent = Extract<
  AiRunEvent,
  { type: 'terminal_step_started' | 'terminal_step_result' | 'terminal_step_error' }
>
type ActivityEvent = Extract<AiRunEvent, { type: 'activity' }>
type ArtifactEvent = Extract<AiRunEvent, { type: 'file_artifact' }>
type HumanStepTraceEvent = Extract<AiRunEvent, { type: 'human_step' }>
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
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiRunId, setAiRunId] = useState<string | null>(null)
  const [aiEvents, setAiEvents] = useState<AiRunEvent[]>([])
  const [aiPlan, setAiPlan] = useState<AiPlanTask[]>([])
  const [selectedSourceScopes, setSelectedSourceScopes] = useState<SourceScopeSelection[]>([])
  const [localSourceStatus, setLocalSourceStatus] = useState<{
    status: 'used' | 'not_used' | 'insufficient'
    summary: string
  } | null>(null)
  const [pendingApprovalRequest, setPendingApprovalRequest] = useState<ApprovalRequiredEvent | null>(
    null
  )
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const [pendingNonLocalRequest, setPendingNonLocalRequest] = useState<{
    input: string
    scopes: SourceScopeSelection[]
    reason: string
  } | null>(null)
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

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
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
      setSelectedSourceScopes([])
      setLocalSourceStatus(null)
      setPendingApprovalRequest(null)
      setApprovalSubmitting(false)
      setPendingNonLocalRequest(null)
      setPendingWorkspaceRequest(null)
      setRightPanel(null)
    } else {
      setCurrentMessages([])
    }
  }, [currentSessionId])

  useEffect(() => {
    scrollToBottom()
  }, [currentMessages])

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
          data: evt as HumanStepTraceEvent
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

      if (evt.type === 'task_result') {
        if (evt.internal) return
        setAiPlan((prev) =>
          prev.map((t) =>
            t.id === evt.taskId
              ? { ...t, resultCode: evt.code, resultMessage: evt.message }
              : t
          )
        )
        return
      }

      if (evt.type === 'task_failed') {
        if (evt.internal) return
        setAiPlan((prev) =>
          prev.map((t) => (t.id === evt.taskId ? { ...t, status: 'failed', error: evt.error } : t))
        )
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

      if (evt.type === 'local_sources_status') {
        if (!evt.internal) {
          setLocalSourceStatus({ status: evt.status, summary: evt.summary })
        }
        return
      }

      if (evt.type === 'non_local_permission_requested') {
        if (!evt.internal) {
          setPendingNonLocalRequest({
            input: lastSubmittedInputRef.current,
            scopes: lastSubmittedScopesRef.current,
            reason: evt.reason
          })
          message.warning('本地资料不足，需要你决定是否允许继续使用非本地信息')
          setLoading(false)
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
    setAiEvents([])
    setAiPlan([])
    setLocalSourceStatus(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingNonLocalRequest(null)
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

    // Update session title if first message
    if (currentMessages.length === 0) {
      const session = sessions.find((s) => s.id === currentSessionId)
      if (session) {
        const newTitle = userQuery.slice(0, 20)
        await window.api.chatSessionSave({ ...session, title: newTitle })
        loadSessions() // Refresh sidebar
      }
    }

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

  const handleAllowNonLocalContinue = async () => {
    if (!pendingNonLocalRequest || !currentSessionId || loading) return

    const permissionMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: '允许使用非本地信息继续处理上一条请求。',
      timestamp: Date.now()
    }
    setCurrentMessages((prev) => [...prev, permissionMessage])
    window.api.chatMessageSave(permissionMessage).catch(console.error)

    setLoading(true)
    setAiEvents([])
    setAiPlan([])
    setLocalSourceStatus(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setRightPanel(null)
    assistantMsgIdRef.current = null
    lastSubmittedInputRef.current = pendingNonLocalRequest.input
    lastSubmittedScopesRef.current = pendingNonLocalRequest.scopes

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
        input: pendingNonLocalRequest.input,
        selectedSourceScopes:
          pendingNonLocalRequest.scopes.length > 0 ? pendingNonLocalRequest.scopes : undefined,
        allowNonLocal: true
      })
      if (!res.success || !res.runId) {
        setLoading(false)
        message.error(res.error || '继续运行失败')
        return
      }
      setPendingNonLocalRequest(null)
      setAiRunId(res.runId)
    } catch (error) {
      console.error(error)
      setLoading(false)
      message.error('继续运行失败')
    }
  }

  const handleDeclineNonLocalContinue = async () => {
    if (!pendingNonLocalRequest || !currentSessionId) return
    const messageRecord: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: currentSessionId,
      role: 'user',
      content: '仅保留基于本地资料的结论，不继续使用非本地信息。',
      timestamp: Date.now()
    }
    setCurrentMessages((prev) => [...prev, messageRecord])
    window.api.chatMessageSave(messageRecord).catch(console.error)
    setLocalSourceStatus(null)
    setPendingNonLocalRequest(null)
    setLoading(false)
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
    setLocalSourceStatus(null)
    setPendingApprovalRequest(null)
    setApprovalSubmitting(false)
    setPendingNonLocalRequest(null)
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

  const renderTrace = () => {
    if (!aiRunId) return null

    const toolCalls = aiEvents.filter(
      (e) => e.type === 'tool_call_started' || e.type === 'tool_call_result'
    ) as ToolCallEvent[]
    const terminalSteps = aiEvents.filter(
      (e) =>
        e.type === 'terminal_step_started' ||
        e.type === 'terminal_step_result' ||
        e.type === 'terminal_step_error'
    ) as TerminalEvent[]

    const toolCallsByTask: Record<string, ToolCallEvent[]> = {}
    for (const evt of toolCalls) {
      const key = String(evt.taskId || '__no_task__')
      if (!toolCallsByTask[key]) toolCallsByTask[key] = []
      toolCallsByTask[key].push(evt)
    }

    const terminalByTask: Record<string, TerminalEvent[]> = {}
    for (const evt of terminalSteps) {
      const key = String(evt.taskId || '__no_task__')
      if (!terminalByTask[key]) terminalByTask[key] = []
      terminalByTask[key].push(evt)
    }

    const artifactsByTask = groupArtifactEventsByTask(aiEvents)

    const total = aiPlan.length
    const completed = aiPlan.filter((t) => t.status === 'completed').length
    const running = aiPlan.find((t) => t.status === 'running')
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0

    const taskPanels = aiPlan.map((t) => {
      const toolItems = toolCallsByTask[t.id] || []
      const terminalItems = terminalByTask[t.id] || []
      const artifactItems = artifactsByTask[t.id] || []
      return (
        <Panel
          key={t.id}
          header={
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#1F1F1F]">{t.title}</span>
                {t.resultCode ? <span className="text-xs text-[#999999]">{t.resultCode}</span> : null}
                {t.status === 'running' ? (
                  <span className="text-[10px] px-2 py-[2px] rounded bg-[#FBF5F2] text-[#D97757]">
                    active
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-[#666666]">{t.status}</span>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {t.resultMessage ? (
              <div className="text-xs text-[#666666] bg-[#F5F5F4] rounded px-2 py-1">
                {t.resultMessage}
              </div>
            ) : null}
            <div>
              <div className="text-xs font-medium text-[#666666] mb-2">Terminal</div>
              {terminalItems.length === 0 ? (
                <div className="text-xs text-[#999999]">暂无终端步骤</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {terminalItems.map((evt, idx) => (
                    <div
                      key={`${evt.stepId || idx}-${idx}`}
                      className="border border-[#E5E5E4] rounded-lg bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-[#1F1F1F]">{evt.type}</div>
                        <div className="text-[11px] text-[#999999]">step {evt.stepIndex}</div>
                      </div>
                      <div className="text-xs text-[#666666] mt-1 whitespace-pre-wrap">
                        {evt.command}
                      </div>
                      <div className="text-xs text-[#999999] mt-1 whitespace-pre-wrap">
                        {'error' in evt
                          ? evt.error
                          : 'outputPreview' in evt
                            ? evt.outputPreview
                            : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-[#666666] mb-2">Tool Calls</div>
              {toolItems.length === 0 ? (
                <div className="text-xs text-[#999999]">暂无工具步骤</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {toolItems.map((evt, idx) => (
                    <div
                      key={`${evt.toolCallId}-${idx}`}
                      className="border border-[#E5E5E4] rounded-lg bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-[#1F1F1F]">{evt.toolName}</div>
                        <div className="text-[11px] text-[#999999]">{evt.type}</div>
                      </div>
                      {evt.type === 'tool_call_started' ? (
                        <div className="text-xs text-[#666666] mt-1 whitespace-pre-wrap">
                          {JSON.stringify(evt.input)}
                        </div>
                      ) : (
                        <div className="text-xs text-[#666666] mt-1 whitespace-pre-wrap">
                          {evt.error ? `[error] ${evt.error}` : JSON.stringify(evt.outputPreview)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-[#666666] mb-2">Artifacts</div>
              {artifactItems.length === 0 ? (
                <div className="text-xs text-[#999999]">暂无文件产物</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {artifactItems.map((evt, idx) => (
                    <div
                      key={`${evt.artifactId}-${idx}`}
                      className="border border-[#E5E5E4] rounded-lg bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-[#1F1F1F] truncate">
                          {evt.fileName}
                        </div>
                        <div className="text-[11px] text-[#999999]">{evt.operation}</div>
                      </div>
                      <div className="text-xs text-[#999999] mt-1 truncate">{evt.path}</div>
                      <div className="text-xs text-[#666666] mt-1">{evt.summary}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          size="small"
                          onClick={() => openArtifactPreview(evt)}
                        >
                          预览
                        </Button>
                        <Button
                          size="small"
                          onClick={async () => {
                            const res = await window.api.openPath(evt.path)
                            if (!res.success) message.error(res.error || '打开失败')
                          }}
                        >
                          打开
                        </Button>
                        <Button
                          size="small"
                          onClick={async () => {
                            const res = await window.api.revealPath(evt.path)
                            if (!res.success) message.error(res.error || '定位失败')
                          }}
                        >
                          定位
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
      )
    })

    return (
      <div className="px-6 pt-4">
        <Collapse
          defaultActiveKey={['plan']}
          size="small"
          className="bg-white border border-[#E5E5E4] rounded-xl overflow-hidden"
          data-testid={chatSelectors.tracePanel}
        >
          <Panel
            header={
              <div className="flex items-center justify-between w-full gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <HiSparkles className="text-[#D97757]" />
                  <span className="text-sm font-medium text-[#1F1F1F]">执行轨迹</span>
                  <span className="text-xs text-[#999999]">{completed}/{total}</span>
                  {running ? (
                    <span className="text-xs text-[#D97757] truncate">
                      进行中: {running.title}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-[#999999]">{aiRunId.slice(0, 8)}</span>
              </div>
            }
            key="plan"
          >
            {aiPlan.length === 0 ? (
              <div className="text-xs text-[#999999]">等待计划生成…</div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <Progress percent={percent} showInfo={false} size="small" strokeColor="#D97757" />
                </div>
                <Collapse ghost size="small">
                  {taskPanels}
                </Collapse>
              </div>
            )}
          </Panel>
        </Collapse>
      </div>
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

  const renderRightPanel = () => {
    return (
      <div
        className="w-[380px] border-l border-[#E5E5E4] bg-[#F5F5F4] flex flex-col h-full"
        data-testid={chatSelectors.rightPanel}
      >
        <div className="p-4">
          <Card
            className="bg-white border border-[#E5E5E4] rounded-xl shadow-sm"
            styles={{ body: { padding: 0 } }}
          >
            <div className="px-4 py-3 border-b border-[#E5E5E4] flex items-center justify-between">
              <div
                className="text-sm font-medium text-[#1F1F1F] truncate"
                data-testid={chatSelectors.rightPanelTitle}
              >
                {rightPanel?.title || '右侧面板'}
              </div>
              <div className="text-xs text-[#999999]">{aiRunId ? aiRunId.slice(0, 8) : ''}</div>
            </div>
            <div className="p-4 max-h-[calc(100vh-220px)] overflow-auto">
              {!rightPanel ? (
                <div className="text-sm text-[#999999]">等待工具输出…</div>
              ) : rightPanel.kind === 'chunks' ? (
                <div className="flex flex-col gap-3" data-testid={chatSelectors.rightPanelChunks}>
                  {(rightPanel.data as SearchResult[]).map((r, idx) => (
                    <div
                      key={`${r.id || idx}`}
                      className="border border-[#E5E5E4] rounded-xl p-3 bg-white hover:border-[#D97757] transition-colors cursor-pointer"
                      onClick={() => openPreview(r)}
                    >
                      <div className="text-xs font-semibold text-[#1F1F1F] truncate">
                        {idx + 1}. {r.document_name}
                      </div>
                      <div className="text-xs text-[#999999] mt-2 whitespace-pre-wrap line-clamp-5">
                        {r.text}
                      </div>
                    </div>
                  ))}
                </div>
              ) : rightPanel.kind === 'docs' ? (
                <div className="flex flex-col gap-2" data-testid={chatSelectors.rightPanelDocs}>
                  {(rightPanel.data as DocumentRecord[]).map((d, idx) => (
                    <div
                      key={`${d.id || idx}`}
                      className="border border-[#E5E5E4] rounded-lg px-3 py-2 bg-white"
                    >
                      <div className="text-xs font-semibold text-[#1F1F1F] truncate">
                        {idx + 1}. {d.name}
                      </div>
                      <div className="text-[11px] text-[#999999] mt-1 truncate">{d.id}</div>
                    </div>
                  ))}
                </div>
              ) : rightPanel.kind === 'artifacts' ? (
                <div className="flex flex-col gap-2" data-testid={chatSelectors.rightPanelArtifacts}>
                  {(rightPanel.data as ArtifactEvent[]).map((evt, idx) => (
                    <div
                      key={`${evt.artifactId || idx}-${idx}`}
                      className="border border-[#E5E5E4] rounded-lg px-3 py-2 bg-white"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-[#1F1F1F] truncate">
                          {evt.fileName}
                        </div>
                        <div className="text-[11px] text-[#999999]">{evt.operation}</div>
                      </div>
                      <div className="text-[11px] text-[#999999] mt-1 truncate">{evt.path}</div>
                      <div className="text-xs text-[#666666] mt-2">{evt.summary}</div>
                      <div className="flex items-center gap-1 mt-2">
                        <Button
                          size="small"
                          onClick={() => openArtifactPreview(evt)}
                        >
                          预览
                        </Button>
                        <Button
                          size="small"
                          onClick={async () => {
                            const res = await window.api.openPath(evt.path)
                            if (!res.success) message.error(res.error || '打开失败')
                          }}
                        >
                          打开
                        </Button>
                        <Button
                          size="small"
                          onClick={async () => {
                            const res = await window.api.revealPath(evt.path)
                            if (!res.success) message.error(res.error || '定位失败')
                          }}
                        >
                          定位
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3" data-testid={chatSelectors.rightPanelJson}>
                  <div className="text-xs text-[#666666] whitespace-pre-wrap">
                    {JSON.stringify(rightPanel.data)}
                  </div>
                  {(() => {
                    const raw =
                      typeof rightPanel.data === 'string'
                        ? rightPanel.data
                        : JSON.stringify(rightPanel.data)
                    const paths = extractAbsolutePaths(raw)
                    if (paths.length === 0) return null
                    return (
                      <div className="flex flex-col gap-2">
                        <div className="text-xs text-[#999999]">检测到可能的产物路径</div>
                        {paths.map((p) => (
                          <div
                            key={p}
                            className="flex items-center justify-between gap-2 border border-[#E5E5E4] rounded px-2 py-1 bg-white"
                          >
                            <div className="text-xs text-[#666666] truncate">{p}</div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="small"
                                onClick={() => navigator.clipboard.writeText(p).catch(() => {})}
                              >
                                复制
                              </Button>
                              <Button
                                size="small"
                                onClick={async () => {
                                  const res = await window.api.openPath(p)
                                  if (!res.success) message.error(res.error || '打开失败')
                                }}
                              >
                                打开
                              </Button>
                              <Button
                                size="small"
                                onClick={async () => {
                                  const res = await window.api.revealPath(p)
                                  if (!res.success) message.error(res.error || '定位失败')
                                }}
                              >
                                定位
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const openPreview = (item: SearchResult) => {
    setCurrentPreviewDoc(item)
    setCurrentPreviewFile(null)
    setPreviewVisible(true)
  }

  const openArtifactPreview = (item: ArtifactEvent) => {
    setCurrentPreviewDoc(null)
    setCurrentPreviewFile({
      filePath: item.path,
      fileName: item.fileName
    })
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
    <div className="flex h-full bg-[#F5F5F4]" data-testid={chatSelectors.page}>
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
        <div className="flex-1 overflow-y-auto" data-testid={chatSelectors.sessionsList}>
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
        {renderTrace()}

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
                  <p>你可以直接提问，系统会执行计划并展示过程</p>
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
              placeholder="输入问题..."
              autoSize={{ minRows: 1, maxRows: 6 }}
              bordered={false}
              className="text-[15px] mb-2"
              data-testid={chatSelectors.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <div className="grid grid-cols-12 gap-2 mb-2">
              <div className="col-span-12" data-testid={chatSelectors.sourceScopeField}>
                <SourceScopeSelect
                  mode="chat"
                  value={selectedSourceScopes}
                  onChange={setSelectedSourceScopes}
                  placeholder="输入 @ 选择优先参考的工作空间、目录、文件或网页资料（可选）"
                  className="w-full"
                />
              </div>
            </div>
            {(localSourceStatus ||
              pendingApprovalRequest ||
              pendingWorkspaceRequest ||
              pendingNonLocalRequest) && (
              <div
                className={`mb-3 rounded-2xl border px-3 py-3 text-sm ${
                  pendingApprovalRequest || pendingWorkspaceRequest || pendingNonLocalRequest
                    ? 'border-[#FDECC8] bg-[#FFF9ED] text-[#8A6510]'
                    : localSourceStatus?.status === 'used'
                      ? 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]'
                      : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]'
                }`}
                data-testid={
                  pendingApprovalRequest
                    ? chatSelectors.approvalBanner
                    : pendingWorkspaceRequest
                      ? chatSelectors.workspaceBanner
                      : pendingNonLocalRequest
                        ? chatSelectors.nonLocalBanner
                        : chatSelectors.localSourceStatus
                }
              >
                {localSourceStatus && <div>{localSourceStatus.summary}</div>}
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
                {pendingNonLocalRequest && (
                  <div className="mt-2 flex flex-col gap-3">
                    <div>{pendingNonLocalRequest.reason}</div>
                    <div className="flex gap-2">
                      <Button
                        type="primary"
                        onClick={handleAllowNonLocalContinue}
                        loading={loading}
                        data-testid={chatSelectors.nonLocalAllowButton}
                      >
                        允许继续
                      </Button>
                      <Button
                        onClick={handleDeclineNonLocalContinue}
                        data-testid={chatSelectors.nonLocalDeclineButton}
                      >
                        仅保留本地结果
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {selectedSourceScopes.some(
              (scope) => scope.sourceType === 'workspace' && scope.hasUnpreparedFiles
            ) && (
              <div className="mb-3 rounded-2xl border border-[#FDECC8] bg-[#FFF9ED] px-3 py-2 text-sm text-[#8A6510]">
                已选范围包含未准备的本地文件。AI 可能直接读取原文件，耗时更长，并增加 token 消耗。
              </div>
            )}
            <div className="flex justify-between items-center">
              <div className="text-xs text-[#999999] flex items-center gap-2">
                <Tooltip title="由主进程执行计划并返回事件流">
                  <span className="flex items-center gap-1 bg-[#F5F5F4] px-2 py-1 rounded cursor-help">
                    <HiBookOpen className="text-[#D97757]" />
                    <span>AI Runner</span>
                  </span>
                </Tooltip>
                <Tooltip title="@ 只是在告诉 AI 优先参考哪些资料，不代表回答只能来自这些资料。">
                  <span className="rounded-full bg-[#F5F5F4] px-2 py-1 text-[#666666]">优先参考范围</span>
                </Tooltip>
                {selectedSourceScopes.length > 0 && (
                  <span className="rounded-full bg-[#FBF5F2] px-2 py-1 text-[#D97757]">
                    已选 {selectedSourceScopes.length} 个参考范围
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {loading && aiRunId && (
                  <Button
                    onClick={handleCancel}
                    className="border-[#E5E5E4]"
                    data-testid={chatSelectors.cancelButton}
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
                  data-testid={chatSelectors.sendButton}
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
