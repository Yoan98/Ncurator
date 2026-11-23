import { t } from '../../../i18n'
import React, { useLayoutEffect, useRef, useState } from 'react'
import { Empty, Spin, Tooltip } from 'antd'
import { LuCircleCheck, LuCircleDashed, LuCircleMinus } from 'react-icons/lu'
import type {
  KbAvailability,
  ReferenceItemListResponse,
  SelectedReference
} from '../../../../../shared/types'
import { workbenchSelectors } from '../../../testing/selectors'
import { getKbAvailabilityLabel } from '../../../utils/reference'
import ReferenceIcon from './ReferenceIcon'
import { REFERENCE_LABEL_CLASS_NAME } from './referenceVisuals'
import { getScopeKey } from './utils'

type ReferenceMentionPanelProps = {
  pending: boolean
  loadingMore: boolean
  options: SelectedReference[]
  resultQuery: string | null
  workspaceRoots: ReferenceItemListResponse['workspaceRoots']
  activeIndex: number
  hasMore: boolean
  onSelect: (reference: SelectedReference) => void
  onLoadMore: () => void
}

type MentionPanelLayout = {
  placement: 'above' | 'below'
  height: number
}

const PANEL_GAP = 8
const PANEL_HEIGHT = 198
const statusIcons = {
  indexed: LuCircleCheck,
  partial: LuCircleMinus,
  not_indexed: LuCircleDashed
} satisfies Record<KbAvailability, React.ComponentType<{ className?: string }>>

const highlightMatch = (value: string, query: string): React.ReactNode => {
  const start = query ? value.toLowerCase().indexOf(query) : -1
  if (start === -1) return value
  return (
    <>
      {value.slice(0, start)}
      <mark className="reference-mention-match">{value.slice(start, start + query.length)}</mark>
      {value.slice(start + query.length)}
    </>
  )
}

const ReferenceMentionPanel: React.FC<ReferenceMentionPanelProps> = ({
  pending,
  loadingMore,
  options,
  resultQuery,
  workspaceRoots,
  activeIndex,
  hasMore,
  onSelect,
  onLoadMore
}) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<MentionPanelLayout>({
    placement: 'above',
    height: PANEL_HEIGHT
  })
  const groups = new Map<
    string,
    { label: string; rows: { reference: SelectedReference; index: number }[] }
  >()
  options.forEach((reference, index) => {
    const key = reference.kind === 'web' ? 'web' : `workspace:${reference.workspaceId}`
    const group = groups.get(key)
    if (group) {
      group.rows.push({ reference, index })
      return
    }
    groups.set(key, {
      label:
        reference.kind === 'web'
          ? t(($) => $.workbench.webpage2)
          : workspaceRoots[reference.workspaceId]?.name || reference.name,
      rows: [{ reference, index }]
    })
  })
  const query = (resultQuery || '').trim().toLowerCase().replaceAll('\\', '/')

  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = panel?.parentElement
    if (!panel || !anchor) return

    const updateLayout = (event?: Event): void => {
      if (event?.target instanceof Node && panel.contains(event.target)) return
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
        const ancestorTop = ancestor.getBoundingClientRect().top + ancestor.clientTop
        clipTop = Math.max(clipTop, ancestorTop)
        clipBottom = Math.min(clipBottom, ancestorTop + ancestor.clientHeight)
      }
      const above = Math.max(0, anchorRect.top - clipTop - PANEL_GAP)
      const below = Math.max(0, clipBottom - anchorRect.bottom - PANEL_GAP)
      const placement = above >= PANEL_HEIGHT || above >= below ? 'above' : 'below'
      const height = Math.min(PANEL_HEIGHT, placement === 'above' ? above : below)
      setLayout((previous) =>
        previous.placement === placement && previous.height === height
          ? previous
          : { placement, height }
      )
    }

    updateLayout()
    const observer = new ResizeObserver(() => updateLayout())
    observer.observe(anchor)
    window.addEventListener('resize', updateLayout)
    window.addEventListener('scroll', updateLayout, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('scroll', updateLayout, true)
    }
  }, [])

  useLayoutEffect(() => {
    const root = scrollRef.current
    if (root) root.scrollTop = 0
  }, [resultQuery])

  useLayoutEffect(() => {
    const root = scrollRef.current
    const active = root?.querySelector('[data-mention-active="true"]')
    if (!root || !active) return
    const bounds = root.getBoundingClientRect()
    const row = active.getBoundingClientRect()
    if (row.top < bounds.top) root.scrollTop -= bounds.top - row.top
    if (row.bottom > bounds.bottom) root.scrollTop += row.bottom - bounds.bottom
  }, [activeIndex, options])

  return (
    <div
      ref={panelRef}
      className={`absolute inset-x-0 z-50 flex flex-col overflow-hidden rounded-[14px] border border-[var(--notion-line-strong)] bg-[var(--notion-page)] p-2 shadow-[0_16px_36px_rgba(15,15,15,0.1)] ${
        layout.placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
      style={{ height: layout.height }}
      data-placement={layout.placement}
      data-testid={workbenchSelectors.mentionPanel}
      aria-busy={pending || loadingMore}
    >
      {pending ? (
        <span className="pointer-events-none absolute right-4 top-2.5 z-10">
          <Spin size="small" />
        </span>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
        onScroll={() => {
          const root = scrollRef.current
          if (
            root &&
            !pending &&
            !loadingMore &&
            hasMore &&
            root.scrollHeight - root.scrollTop - root.clientHeight < 48
          )
            onLoadMore()
        }}
      >
        {!options.length && !pending ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t(($) => $.workbench.noMatchingSources)}
          />
        ) : (
          <div className="space-y-2">
            {Array.from(groups, ([key, group]) => (
              <div key={key} role="group" aria-label={group.label}>
                <div className="truncate px-2.5 pb-0.5 text-[11px] font-medium leading-5 text-[var(--notion-text-soft)]">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.rows.map(({ reference, index }) => {
                    const active = activeIndex === index
                    const root =
                      reference.kind === 'web' ? undefined : workspaceRoots[reference.workspaceId]
                    const path =
                      reference.kind === 'web'
                        ? reference.url
                        : root
                          ? reference.absolutePath === root.path
                            ? root.name + (reference.kind === 'directory' ? '/' : '')
                            : `${root.name}/${reference.relativePath}`
                          : reference.relativePath
                    const StatusIcon = statusIcons[reference.kbAvailability]
                    const status = getKbAvailabilityLabel(reference.kbAvailability)
                    return (
                      <button
                        key={getScopeKey(reference)}
                        type="button"
                        tabIndex={-1}
                        className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-[8px] px-2.5 text-left ${
                          active
                            ? 'bg-[var(--notion-accent-selection)] shadow-[inset_2px_0_var(--notion-accent-blue)]'
                            : 'hover:bg-[var(--notion-surface-hover)]'
                        }`}
                        data-reference-kind={reference.kind}
                        data-mention-active={active ? 'true' : undefined}
                        aria-current={active || undefined}
                        aria-disabled={pending || undefined}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          if (!pending) onSelect(reference)
                        }}
                      >
                        <ReferenceIcon reference={reference} size="sm" />
                        <span
                          className={`min-w-0 flex-1 truncate text-[13px] leading-5 ${REFERENCE_LABEL_CLASS_NAME}`}
                        >
                          {highlightMatch(reference.name, query)}
                        </span>
                        <Tooltip title={path}>
                          <span
                            data-reference-path
                            className="max-w-[46%] shrink-0 truncate text-right text-[11px] text-[var(--notion-text-soft)]"
                          >
                            {path}
                          </span>
                        </Tooltip>
                        <Tooltip title={status}>
                          <span
                            data-reference-index-status
                            className="ml-1 flex h-6 w-5 shrink-0 items-center justify-end text-[var(--file-icon-neutral)]"
                          >
                            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">{status}</span>
                          </span>
                        </Tooltip>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {loadingMore ? (
              <div className="flex justify-center py-1">
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
