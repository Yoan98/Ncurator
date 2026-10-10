import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Tooltip } from 'antd'
import PartnerAvatar from './PartnerAvatar'
import type { AssistantProcessGroup, SubagentTaskView } from './types'
import { getSubagentAvatar } from './utils'

const SubagentThought: React.FC<{
  child: SubagentTaskView
  open: boolean
  showDelivery: boolean
}> = ({ child, open, showDelivery }) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const active = child.status === 'running'
  const text =
    child.status === 'failed' || child.status === 'blocked'
      ? `我干失败了：${child.result?.trim() || '未知错误'}`
      : child.status === 'queued'
        ? '我在排队'
        : child.status === 'completed' && !showDelivery
          ? '已完成'
          : active
            ? child.message?.trim()
              ? child.message
              : '我在思考中'
            : child.result ||
              {
                waiting_approval: '等待你审核操作',
                completed: '任务已完成',
                failed: '执行失败',
                cancelled: '已停止',
                blocked: '需要主伙伴继续处理',
                interrupted: '执行被中断，未收到完整结果'
              }[child.status]
  const streaming = active && child.streaming && Boolean(child.message?.trim())
  useLayoutEffect(() => {
    if (!open || !contentRef.current) return
    const content = contentRef.current
    const scrollToLatest = (): void => {
      content.scrollTop = content.scrollHeight
    }
    scrollToLatest()
    const frame = requestAnimationFrame(scrollToLatest)
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [open, text, streaming])
  return (
    <div
      data-testid="subagent-thought"
      data-child-run-id={child.childRunId}
      data-message-id={child.messageId}
      data-message-started-at={child.messageStartedAt}
      className="nc-subagent-thought-cloud"
    >
      <svg
        className="nc-subagent-thought-outline"
        viewBox="0 0 264 110"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M30 94C9 94 1 74 11 60C0 45 10 25 30 24C36 5 60 2 74 14C86 0 109 0 120 13C139 0 161 5 169 18C189 6 210 15 214 28C240 22 259 38 254 57C270 74 254 97 232 96C220 111 195 108 184 98C166 112 143 109 131 99C113 112 89 107 81 97C65 111 42 107 30 94Z" />
      </svg>
      <div ref={contentRef} className="nc-subagent-thought-lines">
        <span data-testid="subagent-message">{streaming ? text.trimEnd() : text}</span>
        {streaming ? (
          <span
            data-testid="subagent-stream-dot"
            className="nc-subagent-stream-dot"
            aria-label="正在输出文字"
          />
        ) : null}
      </div>
    </div>
  )
}

const AUTO_CLOUD_HOLD_MS = 2000
const SubagentCloudContext = createContext<
  | {
      openChildId?: string
      automaticChildId?: string
      setManualChildId: React.Dispatch<React.SetStateAction<string | undefined>>
    }
  | undefined
>(undefined)

export const SubagentCloudProvider: React.FC<{
  groups: AssistantProcessGroup[]
  children: React.ReactNode
}> = ({ groups, children }) => {
  const tasks = useMemo(() => groups.flatMap((group) => group.subagents || []), [groups])
  const [manualChildId, setManualChildId] = useState<string>()
  const [automaticMessage, setAutomaticMessage] = useState<{
    childId: string
    messageId: string
  }>()
  // Existing view state on mount is history, including when returning to a running partner.
  const seen = useRef(
    new Map(tasks.map((child) => [child.id, child.message?.trim() ? child.messageId : undefined]))
  )
  useEffect(() => {
    let latest: SubagentTaskView | undefined
    for (const child of tasks) {
      const visibleMessageId = child.message?.trim() ? child.messageId : undefined
      if (
        visibleMessageId &&
        child.messageStartedAt !== undefined &&
        seen.current.get(child.id) !== visibleMessageId
      ) {
        if (!latest || (child.messageStartedAt || 0) >= (latest.messageStartedAt || 0))
          latest = child
      }
      seen.current.set(child.id, visibleMessageId)
    }
    if (latest?.messageId) setAutomaticMessage({ childId: latest.id, messageId: latest.messageId })
  }, [tasks])
  const automatic = tasks.find(
    (child) =>
      child.id === automaticMessage?.childId &&
      child.messageId === automaticMessage.messageId &&
      child.message?.trim()
  )
  const automaticPresent = Boolean(automatic)
  const streaming = automatic?.status === 'running' && automatic.streaming
  useEffect(() => {
    if (!automaticMessage) return
    if (!automaticPresent) {
      setAutomaticMessage((current) => (current === automaticMessage ? undefined : current))
      return
    }
    if (streaming) return
    const timer = window.setTimeout(
      () => setAutomaticMessage((current) => (current === automaticMessage ? undefined : current)),
      AUTO_CLOUD_HOLD_MS
    )
    return () => window.clearTimeout(timer)
  }, [automaticMessage, automaticPresent, streaming])

  return (
    <SubagentCloudContext.Provider
      value={{
        openChildId: manualChildId || automatic?.id,
        automaticChildId: automatic?.id,
        setManualChildId
      }}
    >
      {children}
    </SubagentCloudContext.Provider>
  )
}

const SubagentGroupView: React.FC<{ group: AssistantProcessGroup }> = ({ group }) => {
  const cloud = useContext(SubagentCloudContext)
  if (!cloud) throw new Error('SubagentGroupView requires SubagentCloudProvider')
  const { openChildId, setManualChildId } = cloud
  return (
    <div data-testid="subagent-group" className="flex flex-col items-start gap-1 py-1">
      {(group.subagents || []).map((child) => {
        const open = openChildId === child.id
        return (
          <Tooltip
            key={child.id}
            open={open}
            placement="topLeft"
            align={{ offset: [20, -12] }}
            trigger={['hover', 'focus']}
            arrow={false}
            color="transparent"
            overlayClassName="nc-subagent-thought-tooltip"
            mouseEnterDelay={0.15}
            onOpenChange={(next) =>
              setManualChildId((current) =>
                next ? child.id : current === child.id ? undefined : current
              )
            }
            title={
              <SubagentThought
                child={child}
                open={open}
                showDelivery={cloud.automaticChildId === child.id}
              />
            }
          >
            <button
              type="button"
              data-testid="subagent-task"
              data-child-run-id={child.childRunId}
              data-agent-id={child.agentId}
              data-status={child.status}
              aria-label={child.name}
              className={`flex items-center gap-1.5 rounded-lg py-1 pr-1 text-left text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-[#9B9A97] ${child.status === 'queued' ? 'text-[#9B9A97]' : 'text-[#37352F]'}`}
            >
              <span className={child.status === 'queued' ? 'grayscale opacity-40' : undefined}>
                <PartnerAvatar
                  {...getSubagentAvatar(child.agentId || child.id)}
                  size={32}
                  animated={child.status === 'running'}
                  animationSeed={child.agentId || child.id}
                />
              </span>
              <span className="max-w-[8em] truncate">{child.name}</span>
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

export default SubagentGroupView
