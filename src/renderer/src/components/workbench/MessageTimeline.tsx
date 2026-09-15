import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DatePicker, Tooltip } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { HiMagnifyingGlass } from 'react-icons/hi2'
import {
  collectSelectableDaysForNode,
  shouldUseCompactTimeline,
  startOfLocalDay,
  type TimelineNode
} from '../../../../shared/workbench/messageTimeline'
import { workbenchSelectors } from '../../testing/selectors'

type MessageTimelineProps = {
  nodes: TimelineNode[]
  messageDayStarts: number[]
  activeNodeId: string | null
  onSelectNode: (node: TimelineNode) => void
  onPickDay: (dayStart: number) => void
}

const resolveTimelineLayoutAnchor = (host: HTMLElement): HTMLElement | null => {
  const anchor = host.querySelector('.nc-timeline-layout-anchor')
  return anchor instanceof HTMLElement ? anchor : null
}

const measureTimelineLayout = (
  timelineRoot: HTMLElement
): { composerClearancePx: number; lineEndPx: number; leftGutterPx: number; hostWidthPx: number } | null => {
  const host = timelineRoot.parentElement
  if (!host) return null
  const anchor = resolveTimelineLayoutAnchor(host)
  if (!anchor) return null
  const hostRect = host.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  const composerClearancePx = Math.max(0, Math.round(hostRect.bottom - anchorRect.top))
  const leftGutterPx = Math.max(0, Math.round(anchorRect.left - hostRect.left))
  const hostWidthPx = Math.max(0, Math.round(hostRect.width))
  timelineRoot.style.setProperty('--nc-timeline-composer-clearance', `${composerClearancePx}px`)

  const lastTrack = timelineRoot.querySelector(
    '.nc-message-timeline-row:last-child .nc-message-timeline-track'
  )
  let lineEndPx = composerClearancePx + 8
  if (lastTrack instanceof HTMLElement) {
    const rootRect = timelineRoot.getBoundingClientRect()
    const trackRect = lastTrack.getBoundingClientRect()
    lineEndPx = Math.max(
      0,
      Math.round(rootRect.bottom - (trackRect.top + trackRect.height / 2))
    )
  }
  timelineRoot.style.setProperty('--nc-timeline-line-end', `${lineEndPx}px`)
  return { composerClearancePx, lineEndPx, leftGutterPx, hostWidthPx }
}

export const MessageTimeline = ({
  nodes,
  messageDayStarts,
  activeNodeId,
  onSelectNode,
  onPickDay
}: MessageTimelineProps): React.JSX.Element | null => {
  const rootRef = useRef<HTMLDivElement>(null)
  const [openPickerNodeId, setOpenPickerNodeId] = useState<string | null>(null)
  const [blockNodeClicks, setBlockNodeClicks] = useState(false)
  const [aligned, setAligned] = useState(false)
  const [compact, setCompact] = useState(false)

  useLayoutEffect(() => {
    if (nodes.length === 0) {
      setAligned(false)
      setCompact(false)
      return
    }
    const root = rootRef.current
    if (!root) return
    const host = root.parentElement
    if (!host) return

    const sync = (): void => {
      const layout = measureTimelineLayout(root)
      if (layout == null) {
        // 短暂无锚点（Composer↔审批切换）时保留上一帧，避免轴线闪断、紧凑态被误关。
        return
      }
      setAligned(true)
      const nextCompact = shouldUseCompactTimeline({
        hostWidthPx: layout.hostWidthPx,
        leftGutterPx: layout.leftGutterPx
      })
      setCompact(nextCompact)
      if (nextCompact) setOpenPickerNodeId(null)
    }

    sync()
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(host)
    resizeObserver.observe(root)
    const shell = host.querySelector(`[data-testid="${workbenchSelectors.composerShell}"]`)
    const mutationObserver =
      shell instanceof Element
        ? new MutationObserver(() => {
            const nextAnchor = resolveTimelineLayoutAnchor(host)
            if (nextAnchor) resizeObserver.observe(nextAnchor)
            sync()
          })
        : null
    if (shell instanceof Element) {
      resizeObserver.observe(shell)
      mutationObserver?.observe(shell, { childList: true, subtree: true })
    }
    const anchor = resolveTimelineLayoutAnchor(host)
    if (anchor) resizeObserver.observe(anchor)
    window.addEventListener('resize', sync)
    return () => {
      resizeObserver.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [nodes.length])

  if (nodes.length === 0) return null

  return (
    <div
      ref={rootRef}
      className={`nc-message-timeline${aligned ? ' is-aligned' : ''}${compact ? ' is-compact' : ''}`}
      data-testid={workbenchSelectors.timeline}
      data-compact={compact ? 'true' : 'false'}
    >
      <div className="nc-message-timeline-nodes">
        {nodes.map((node) => {
          const isActive = node.id === activeNodeId
          const showDayPicker = !compact && (node.level === 'month' || node.level === 'year')
          const itemButton = (
            <button
              type="button"
              className={`nc-message-timeline-item${
                blockNodeClicks || openPickerNodeId ? ' is-click-blocked' : ''
              }`}
              data-testid={`${workbenchSelectors.timelineItemPrefix}-${node.id}`}
              aria-label={node.label}
              onClick={() => onSelectNode(node)}
            >
              <span className="nc-message-timeline-track" aria-hidden="true">
                <span className={`nc-message-timeline-dot nc-message-timeline-dot-${node.level}`} />
              </span>
              {!compact ? <span className="nc-message-timeline-label">{node.label}</span> : null}
            </button>
          )
          return (
            <div
              key={node.id}
              className={`nc-message-timeline-row nc-message-timeline-row-${node.level}${
                isActive ? ' is-active' : ''
              }`}
            >
              {compact ? (
                <Tooltip title={node.label} placement="right" mouseEnterDelay={0.15}>
                  {itemButton}
                </Tooltip>
              ) : (
                itemButton
              )}
              {showDayPicker ? (
                <TimelineDayPicker
                  node={node}
                  messageDayStarts={messageDayStarts}
                  open={openPickerNodeId === node.id}
                  onOpenChange={(open) => setOpenPickerNodeId(open ? node.id : null)}
                  onPickDay={(dayStart) => {
                    setBlockNodeClicks(true)
                    setOpenPickerNodeId(null)
                    onPickDay(dayStart)
                    window.setTimeout(() => setBlockNodeClicks(false), 80)
                  }}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type TimelineDayPickerProps = {
  node: TimelineNode
  messageDayStarts: number[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPickDay: (dayStart: number) => void
}

const TimelineDayPicker = ({
  node,
  messageDayStarts,
  open,
  onOpenChange,
  onPickDay
}: TimelineDayPickerProps): React.JSX.Element => {
  const selectableDays = useMemo(
    () => collectSelectableDaysForNode(node, messageDayStarts),
    [messageDayStarts, node]
  )
  const selectableSet = useMemo(() => new Set(selectableDays), [selectableDays])
  const defaultPickerValue = useMemo(() => {
    const latest = selectableDays[selectableDays.length - 1]
    return dayjs(latest ?? node.jumpDayStart)
  }, [node.jumpDayStart, selectableDays])
  const [pickerEpoch, setPickerEpoch] = useState(0)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      setPickerEpoch((current) => current + 1)
    }
    wasOpenRef.current = open
  }, [open])

  return (
    <div className="nc-message-timeline-picker">
      <button
        type="button"
        className="nc-message-timeline-search"
        data-testid={`${workbenchSelectors.timelineItemPrefix}-search-${node.id}`}
        aria-label={`选择${node.label}内的日期`}
        onClick={(event) => {
          event.stopPropagation()
          onOpenChange(true)
        }}
      >
        <HiMagnifyingGlass className="h-3 w-3" />
      </button>
      <DatePicker
        key={pickerEpoch}
        open={open}
        onOpenChange={onOpenChange}
        value={null}
        allowClear={false}
        showToday={false}
        inputReadOnly
        defaultPickerValue={defaultPickerValue}
        disabledDate={(current) => {
          if (!current) return true
          const dayStart = startOfLocalDay(current.valueOf())
          if (dayStart < node.rangeStart || dayStart >= node.rangeEnd) return true
          return !selectableSet.has(dayStart)
        }}
        onChange={(value: Dayjs | null) => {
          if (!value) return
          onPickDay(startOfLocalDay(value.valueOf()))
        }}
        getPopupContainer={(trigger) => trigger.parentElement || document.body}
        className="nc-message-timeline-datepicker"
        popupClassName="nc-message-timeline-datepicker-popup"
      />
    </div>
  )
}
