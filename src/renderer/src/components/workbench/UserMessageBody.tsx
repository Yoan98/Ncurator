import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HiChevronDown } from 'react-icons/hi2'
import type { ChatMessageContentNode } from '../../../../shared/types'
import { t } from '../../i18n'
import { workbenchSelectors } from '../../testing/selectors'
import ChatContent from './composer/ChatContent'

/** 折叠上限：正文 7 行 × 24px。气泡再加 10px 上下内边距，折叠后总高 188px。 */
const USER_MESSAGE_TEXT_MAX_HEIGHT = 168

type UserMessageBodyProps = {
  messageId: string
  contentNodes: ChatMessageContentNode[]
  actions?: React.ReactNode
  onToggle?: () => void
}

const UserMessageBody: React.FC<UserMessageBodyProps> = ({
  messageId,
  contentNodes,
  actions,
  onToggle
}) => {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const textId = `user-message-text-${messageId}`

  const measureOverflow = useCallback(() => {
    const element = contentRef.current
    if (!element) return
    const next = element.scrollHeight > USER_MESSAGE_TEXT_MAX_HEIGHT + 1
    setOverflowing((current) => (current === next ? current : next))
  }, [])

  // 先测量再绘制，避免长消息先完整展开一帧再收起
  useLayoutEffect(() => {
    measureOverflow()
  }, [measureOverflow])

  useEffect(() => {
    const element = contentRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureOverflow())
    observer.observe(element)
    return () => observer.disconnect()
  }, [measureOverflow])

  const handleToggle = (): void => {
    setExpanded((current) => !current)
    onToggle?.()
  }

  return (
    <div className="flex w-full min-w-0 flex-col items-end">
      <div className="relative box-border w-fit max-w-[66%] min-w-0 rounded-[22px] bg-[var(--notion-surface)] px-4 py-[10px] text-[14px] leading-6 text-[var(--notion-text)] [overflow-wrap:anywhere]">
        <div
          ref={contentRef}
          id={textId}
          className={`min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
            expanded ? '' : 'max-h-[168px] overflow-hidden'
          }`}
          data-testid={workbenchSelectors.userMessageReferences}
        >
          <ChatContent nodes={contentNodes} />
        </div>
        {overflowing && !expanded ? (
          <div className="nc-user-message-fade" aria-hidden="true" />
        ) : null}
      </div>
      <div className="mt-1 flex h-6 items-center justify-end gap-1.5 text-[12px] leading-none text-[var(--notion-text-faint)]">
        {actions ? (
          <span
            className="flex items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100"
            data-testid={`${workbenchSelectors.userMessageActionsPrefix}-${messageId}`}
          >
            {actions}
          </span>
        ) : null}
        {overflowing ? (
          <button
            type="button"
            className="inline-flex h-6 items-center gap-0.5 rounded-[6px] px-1 text-[var(--notion-text-soft)] outline-none transition-colors hover:bg-[var(--notion-surface)] hover:text-[var(--notion-text)] focus-visible:ring-2 focus-visible:ring-[var(--notion-accent-blue)]"
            aria-expanded={expanded}
            aria-controls={textId}
            data-testid={`${workbenchSelectors.userMessageFoldTogglePrefix}-${messageId}`}
            onClick={handleToggle}
          >
            {expanded ? t(($) => $.workbench.collapseMessage) : t(($) => $.workbench.expandMessage)}
            <HiChevronDown
              className={`h-3 w-3 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default UserMessageBody
