import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import type { SelectedReference } from '../../../../../shared/types'
import { workbenchSelectors } from '../../../testing/selectors'
import { getKbAvailabilityLabel } from '../../../utils/reference'
import ReferenceIcon from './ReferenceIcon'
import { getReferenceVisualSpec } from './referenceVisuals'
import { getScopeKey } from './utils'

type ReferenceMentionPanelProps = {
  loading: boolean
  loadingMore: boolean
  options: SelectedReference[]
  activeIndex: number
  hasMore: boolean
  onSelect: (reference: SelectedReference) => void
  onLoadMore: () => void
}

type ReferenceMentionGroup = {
  title: '文件' | '网页'
  items: SelectedReference[]
}

type MentionPanelLayout = {
  placement: 'above' | 'below'
  maxHeight: number
}

const PANEL_GAP = 8
const PANEL_CHROME_HEIGHT = 18
const PANEL_MAX_HEIGHT = 198
const PANEL_CONTENT_MAX_HEIGHT = 180

const getReferenceParentDisplayPath = (reference: SelectedReference): string => {
  if (reference.kind === 'web') return reference.url
  if (!reference.relativePath) return ''
  const pathParts = reference.relativePath.split('/').filter(Boolean)
  pathParts.pop()
  return pathParts.join('/')
}

const ReferenceMentionPanel: React.FC<ReferenceMentionPanelProps> = ({
  loading,
  loadingMore,
  options,
  activeIndex,
  hasMore,
  onSelect,
  onLoadMore
}) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<MentionPanelLayout>({
    placement: 'above',
    maxHeight: PANEL_MAX_HEIGHT
  })
  const groups = [
    {
      title: '文件',
      items: options.filter((reference) => reference.kind !== 'web')
    },
    {
      title: '网页',
      items: options.filter((reference) => reference.kind === 'web')
    }
  ] satisfies ReferenceMentionGroup[]
  const visibleGroups = groups.filter((group) => group.items.length > 0)

  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = panel?.parentElement
    if (!panel || !anchor) return

    const updateLayout = (): void => {
      const anchorRect = anchor.getBoundingClientRect()
      let clipTop = 0
      let clipBottom = window.innerHeight

      for (
        let ancestor = anchor.parentElement;
        ancestor && clipBottom > clipTop;
        ancestor = ancestor.parentElement
      ) {
        const overflowY = window.getComputedStyle(ancestor).overflowY
        if (!['auto', 'scroll', 'hidden', 'clip'].includes(overflowY)) continue
        const rect = ancestor.getBoundingClientRect()
        const ancestorTop = rect.top + ancestor.clientTop
        clipTop = Math.max(clipTop, ancestorTop)
        clipBottom = Math.min(clipBottom, ancestorTop + ancestor.clientHeight)
      }

      const availableAbove = Math.max(0, anchorRect.top - clipTop - PANEL_GAP)
      const availableBelow = Math.max(0, clipBottom - anchorRect.bottom - PANEL_GAP)
      const contentHeight = scrollRef.current?.scrollHeight || 0
      const naturalHeight = Math.min(
        PANEL_MAX_HEIGHT,
        Math.max(72, contentHeight + PANEL_CHROME_HEIGHT)
      )
      const placement: MentionPanelLayout['placement'] =
        availableAbove >= naturalHeight || availableAbove >= availableBelow ? 'above' : 'below'
      const availableHeight = placement === 'above' ? availableAbove : availableBelow
      const maxHeight = Math.min(PANEL_MAX_HEIGHT, availableHeight)

      setLayout((current) =>
        current.placement === placement && current.maxHeight === maxHeight
          ? current
          : { placement, maxHeight }
      )
    }

    updateLayout()
    const resizeObserver = new ResizeObserver(updateLayout)
    resizeObserver.observe(anchor)
    resizeObserver.observe(panel)
    if (scrollRef.current) resizeObserver.observe(scrollRef.current)
    window.addEventListener('resize', updateLayout)
    window.addEventListener('scroll', updateLayout, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('scroll', updateLayout, true)
    }
  }, [loading, options.length])

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const active = root.querySelector<HTMLElement>('[data-mention-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, options])

  const handleScroll = (): void => {
    const root = scrollRef.current
    if (!root || loading || loadingMore || !hasMore) return
    const remaining = root.scrollHeight - root.scrollTop - root.clientHeight
    if (remaining < 48) onLoadMore()
  }

  return (
    <div
      ref={panelRef}
      className={`absolute inset-x-0 z-50 overflow-hidden rounded-[14px] border border-[#E5E4E0] bg-white px-2 py-2 shadow-[0_16px_36px_rgba(15,15,15,0.1)] ${
        layout.placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
      style={{ maxHeight: `${layout.maxHeight}px` }}
      data-placement={layout.placement}
      data-testid={workbenchSelectors.mentionPanel}
    >
      <div
        ref={scrollRef}
        className="overflow-y-auto pr-1"
        style={{
          maxHeight: `${Math.max(0, Math.min(PANEL_CONTENT_MAX_HEIGHT, layout.maxHeight - PANEL_CHROME_HEIGHT))}px`
        }}
        onScroll={handleScroll}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[#9B9A97]">
            <Spin size="small" />
          </div>
        ) : options.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的资料" />
        ) : (
          <div className="space-y-2">
            {visibleGroups.map((group) => (
              <div key={group.title}>
                <div className="px-2.5 pb-0.5 text-[11px] font-medium leading-5 text-[#9B9A97]">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((reference) => {
                    const optionIndex = options.findIndex(
                      (option) => getScopeKey(option) === getScopeKey(reference)
                    )
                    const active = activeIndex === optionIndex
                    const parentPath = getReferenceParentDisplayPath(reference)
                    const visualSpec = getReferenceVisualSpec(reference)
                    return (
                      <button
                        key={getScopeKey(reference)}
                        type="button"
                        tabIndex={-1}
                        className={`flex h-8 w-full items-center gap-[2px] rounded-[8px] px-2.5 text-left transition-colors ${
                          active ? 'bg-[#F1F1F0]' : 'hover:bg-[#F7F7F5]'
                        }`}
                        data-reference-kind={reference.kind}
                        data-mention-active={active ? 'true' : undefined}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          onSelect(reference)
                        }}
                      >
                        <ReferenceIcon reference={reference} size="sm" />
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className={`truncate text-[13px] font-normal leading-5 ${visualSpec.labelClassName}`}
                          >
                            {reference.name}
                          </span>
                          {parentPath ? (
                            <span className="truncate text-[11px] font-normal leading-4 text-[#B1B0AD]">
                              {parentPath}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[10px] text-[#B1B0AD]">
                          {getKbAvailabilityLabel(reference.kbAvailability)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {loadingMore ? (
              <div className="flex justify-center py-2 text-[#9B9A97]">
                <Spin size="small" />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

export default ReferenceMentionPanel
