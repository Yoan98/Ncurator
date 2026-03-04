import React, { useState, useEffect, useRef } from 'react'
import { Input, Button, Card, message, Collapse, Avatar, Tooltip, Space, Select, Progress } from 'antd'
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
  IpcJsonValue
} from '../../../shared/types'
import { groupArtifactEventsByTask } from '../../../shared/aiRunEventUtils'
import { parseIpcResult } from '../utils/serialization'
import FileRender, { FileRenderDocument } from '../components/fileRenders'
import MarkdownRenderer from '../components/MarkdownRenderer'

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
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [mentionOptions, setMentionOptions] = useState<DocumentRecord[]>([])
  const [workspaceRootPath, setWorkspaceRootPath] = useState('')
  const [rightPanel, setRightPanel] = useState<RightPanelState | null>(null)
  const assistantMsgIdRef = useRef<string | null>(null)
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
      setSelectedDocumentIds([])
      setMentionOptions([])
      setWorkspaceRootPath('')
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

  const searchMentionDocs = async (keyword: string) => {
    const raw = String(keyword || '').trim()
    const k = raw.startsWith('@') ? raw.slice(1) : raw
    try {
      const res = await window.api.listDocuments({
        keyword: k || undefined,
        page: 1,
        pageSize: 20
      })
      setMentionOptions(res.items || [])
    } catch {
      // ignore
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
          message.warning(evt.reason || '执行任务需要先绑定工作区')
        }
        setRightPanel({
          title: '工作区要求',
          kind: 'json',
          data: evt
        })
        return
      }

      if (evt.type === 'approval_required') {
        if (!evt.internal) {
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
        if (evt.approved) {
          message.success('审批已通过')
        } else {
          message.warning(evt.reason || '审批未通过')
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
        message.info('已取消')
        return
      }

      if (evt.type === 'run_completed') {
        setLoading(false)
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
    const normalizedWorkspaceRoot = workspaceRootPath.trim()
    if (likelyExecutable && !normalizedWorkspaceRoot) {
      message.warning('该请求可能触发本地执行，请先填写工作区根路径')
      return
    }

    setInput('')
    setLoading(true)
    setAiEvents([])
    setAiPlan([])
    setRightPanel(null)
    assistantMsgIdRef.current = null

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

      const workspace =
        normalizedWorkspaceRoot.length > 0
          ? {
              workspaceId:
                normalizedWorkspaceRoot.split(/[\\/]/).filter(Boolean).pop() ||
                normalizedWorkspaceRoot,
              rootPath: normalizedWorkspaceRoot,
              policyProfile: 'default'
            }
          : undefined
      const res = await window.api.aiRunStart({
        sessionId: currentSessionId,
        input: userQuery,
        selectedDocumentIds: selectedDocumentIds.length ? selectedDocumentIds : undefined,
        workspace
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
      <div className="w-[380px] border-l border-[#E5E5E4] bg-[#F5F5F4] flex flex-col h-full">
        <div className="p-4">
          <Card
            className="bg-white border border-[#E5E5E4] rounded-xl shadow-sm"
            styles={{ body: { padding: 0 } }}
          >
            <div className="px-4 py-3 border-b border-[#E5E5E4] flex items-center justify-between">
              <div className="text-sm font-medium text-[#1F1F1F] truncate">
                {rightPanel?.title || '右侧面板'}
              </div>
              <div className="text-xs text-[#999999]">{aiRunId ? aiRunId.slice(0, 8) : ''}</div>
            </div>
            <div className="p-4 max-h-[calc(100vh-220px)] overflow-auto">
              {!rightPanel ? (
                <div className="text-sm text-[#999999]">等待工具输出…</div>
              ) : rightPanel.kind === 'chunks' ? (
                <div className="flex flex-col gap-3">
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
                <div className="flex flex-col gap-2">
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
                <div className="flex flex-col gap-2">
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
                <div className="flex flex-col gap-3">
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
    <div className="flex h-full bg-[#F5F5F4]">
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
        <div className="flex-1 overflow-y-auto">
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <div className="grid grid-cols-12 gap-2 mb-2">
              <div className="col-span-7">
                <Select
                  mode="multiple"
                  value={selectedDocumentIds}
                  onChange={(vals) => setSelectedDocumentIds(vals)}
                  onSearch={searchMentionDocs}
                  filterOption={false}
                  options={mentionOptions.map((d) => ({ label: d.name, value: d.id }))}
                  placeholder="输入 @ 搜索导入文档范围（可选）"
                  className="w-full"
                />
              </div>
              <div className="col-span-5">
                <Input
                  value={workspaceRootPath}
                  onChange={(e) => setWorkspaceRootPath(e.target.value)}
                  placeholder="工作区根路径（执行任务必填）"
                />
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div className="text-xs text-[#999999] flex items-center gap-2">
                <Tooltip title="由主进程执行计划并返回事件流">
                  <span className="flex items-center gap-1 bg-[#F5F5F4] px-2 py-1 rounded cursor-help">
                    <HiBookOpen className="text-[#D97757]" />
                    <span>AI Runner</span>
                  </span>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                {loading && aiRunId && (
                  <Button onClick={handleCancel} className="border-[#E5E5E4]">
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
