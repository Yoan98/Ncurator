import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DatePicker } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { HiMagnifyingGlass } from 'react-icons/hi2'
import {
  collectSelectableDaysForNode,
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

const measureTimelineLayout = (
  timelineRoot: HTMLElement
): { composerClearancePx: number; lineEndPx: number } | null => {
  const host = timelineRoot.parentElement
  if (!host) return null
  const composer = host.querySelector('.nc-floating-composer')
  if (!(composer instanceof HTMLElement)) return null
  const hostRect = host.getBoundingClientRect()
  const composerRect = composer.getBoundingClientRect()
  const composerClearancePx = Math.max(0, Math.round(hostRect.bottom - composerRect.top))
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
  return { composerClearancePx, lineEndPx }
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
  const [aligned, setAligned] = useState(false)

  useLayoutEffect(() => {
    if (nodes.length === 0) {
      setAligned(false)
      return
    }
    const root = rootRef.current
    if (!root) return
    const host = root.parentElement
    if (!host) return

    const sync = (): void => {
      const layout = measureTimelineLayout(root)
      setAligned(layout != null)
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
      className={`nc-message-timeline${aligned ? ' is-aligned' : ''}`}
      data-testid={workbenchSelectors.timeline}
    >
      <div className="nc-message-timeline-nodes">
        {nodes.map((node) => {
          const isActive = node.id === activeNodeId
          const showDayPicker = node.level === 'month' || node.level === 'year'
          return (
            <div
              key={node.id}
              className={`nc-message-timeline-row nc-message-timeline-row-${node.level}${
                isActive ? ' is-active' : ''
              }`}
            >
              <button
                type="button"
                className="nc-message-timeline-item"
                data-testid={`${workbenchSelectors.timelineItemPrefix}-${node.id}`}
                onClick={() => onSelectNode(node)}
              >
                <span className="nc-message-timeline-track" aria-hidden="true">
                  <span className={`nc-message-timeline-dot nc-message-timeline-dot-${node.level}`} />
                </span>
                <span className="nc-message-timeline-label">{node.label}</span>
              </button>
              {showDayPicker ? (
                <TimelineDayPicker
                  node={node}
                  messageDayStarts={messageDayStarts}
                  open={openPickerNodeId === node.id}
                  onOpenChange={(open) => setOpenPickerNodeId(open ? node.id : null)}
                  onPickDay={(dayStart) => {
                    setOpenPickerNodeId(null)
                    onPickDay(dayStart)
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
        open={open}
        onOpenChange={onOpenChange}
        value={undefined}
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
