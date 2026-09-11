import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DatePicker, Tooltip } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { HiMagnifyingGlass } from 'react-icons/hi2'
import {
  collectSelectableDaysForNode,
  startOfLocalDay,
  type TimelineNode
} from '../../../../shared/workbench/messageTimeline'
import { workbenchSelectors } from '../../testing/selectors'

/**
 * Composer 左缘相对消息主区左缘的可用 gutter 低于此值时收起文案。
 * 与总栏宽无关：右侧展开后总宽仍可能很大，但左侧留给轴文案的空间已不够。
 * 约等于完整态时间轴宽（56px）+ 少量余量。
 */
const TIMELINE_LABEL_MIN_GUTTER_PX = 72

type MessageTimelineProps = {
  nodes: TimelineNode[]
  messageDayStarts: number[]
  activeNodeId: string | null
  onSelectNode: (node: TimelineNode) => void
  onPickDay: (dayStart: number) => void
}

const measureTimelineLayout = (
  timelineRoot: HTMLElement
): { composerClearancePx: number; lineEndPx: number; leftGutterPx: number } | null => {
  const host = timelineRoot.parentElement
  if (!host) return null
  const composer = host.querySelector('.nc-floating-composer')
  if (!(composer instanceof HTMLElement)) return null
  const hostRect = host.getBoundingClientRect()
  const composerRect = composer.getBoundingClientRect()
  const composerClearancePx = Math.max(0, Math.round(hostRect.bottom - composerRect.top))
  const leftGutterPx = Math.max(0, Math.round(composerRect.left - hostRect.left))
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
  return { composerClearancePx, lineEndPx, leftGutterPx }
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
      setAligned(layout != null)
      const nextCompact =
        layout == null ? false : layout.leftGutterPx < TIMELINE_LABEL_MIN_GUTTER_PX
      setCompact(nextCompact)
      if (nextCompact) setOpenPickerNodeId(null)
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    observer.observe(root)
    const shell = host.querySelector(`[data-testid="${workbenchSelectors.composerShell}"]`)
    if (shell instanceof Element) observer.observe(shell)
    const composer = host.querySelector('.nc-floating-composer')
    if (composer instanceof Element) observer.observe(composer)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
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
