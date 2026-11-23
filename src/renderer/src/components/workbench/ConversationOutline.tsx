import React, { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { workbenchSelectors } from '../../testing/selectors'
import type { ConversationOutlineItem } from '../../../../shared/workbench/conversationOutline'

type ConversationOutlineProps = {
  items: ConversationOutlineItem[]
  activeId: string | null
  onSelect: (item: ConversationOutlineItem) => void
}

const PREVIEW_DELAY_MS = 150
/** Above this many ticks the rail tightens spacing so it still fits the viewport. */
const DENSE_ITEM_COUNT = 18

type PreviewState = {
  id: string
  top: number
}

const ConversationOutlineView: React.FC<ConversationOutlineProps> = ({
  items,
  activeId,
  onSelect
}) => {
  const railRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const clearHoverTimer = useCallback((): void => {
    if (hoverTimerRef.current === null) return
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])

  useEffect(() => clearHoverTimer, [clearHoverTimer])

  const showPreview = useCallback((id: string, element: HTMLElement): void => {
    const rail = railRef.current
    if (!rail) return
    const railRect = rail.getBoundingClientRect()
    const itemRect = element.getBoundingClientRect()
    const center = itemRect.top - railRect.top + itemRect.height / 2
    const clamped = Math.max(44, Math.min(railRect.height - 44, center))
    setPreview({ id, top: clamped })
  }, [])

  const schedulePreview = useCallback(
    (id: string, element: HTMLElement): void => {
      clearHoverTimer()
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null
        showPreview(id, element)
      }, PREVIEW_DELAY_MS)
    },
    [clearHoverTimer, showPreview]
  )

  const hidePreview = useCallback((): void => {
    clearHoverTimer()
    setPreview(null)
  }, [clearHoverTimer])

  const previewItem = preview ? items.find((item) => item.id === preview.id) : undefined

  return (
    <div
      ref={railRef}
      className={`nc-conversation-outline${items.length > DENSE_ITEM_COUNT ? ' is-dense' : ''}`}
      role="navigation"
      aria-label={t(($) => $.workbench.conversationOutline)}
      data-testid={workbenchSelectors.conversationOutline}
    >
      <div className="nc-conversation-outline-ticks">
        {items.map((item) => {
          const isActive = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              className={`nc-conversation-outline-item${isActive ? ' is-active' : ''}`}
              data-kind={item.kind}
              data-length={item.lengthLevel}
              aria-label={item.title || item.snippet}
              aria-current={isActive ? 'true' : undefined}
              data-testid={`${workbenchSelectors.conversationOutlineItemPrefix}-${item.id}`}
              onMouseEnter={(event) => schedulePreview(item.id, event.currentTarget)}
              onMouseLeave={hidePreview}
              onFocus={(event) => {
                clearHoverTimer()
                showPreview(item.id, event.currentTarget)
              }}
              onBlur={hidePreview}
              onClick={() => {
                hidePreview()
                onSelect(item)
              }}
            >
              <span className="nc-conversation-outline-tick" aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {previewItem ? (
        <div
          className="nc-conversation-outline-preview"
          style={{ top: preview?.top }}
          data-testid={workbenchSelectors.conversationOutlinePreview}
          role="presentation"
        >
          {previewItem.title ? (
            <div className="nc-conversation-outline-preview-title">{previewItem.title}</div>
          ) : null}
          {previewItem.snippet ? (
            <div className="nc-conversation-outline-preview-snippet">{previewItem.snippet}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** ChatPage re-renders per streamed token; the rail only changes with its items. */
export const ConversationOutline = React.memo(ConversationOutlineView)
