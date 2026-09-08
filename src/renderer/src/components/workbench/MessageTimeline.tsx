import React, { useMemo, useState } from 'react'
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

export const MessageTimeline = ({
  nodes,
  messageDayStarts,
  activeNodeId,
  onSelectNode,
  onPickDay
}: MessageTimelineProps): React.JSX.Element | null => {
  const [openPickerNodeId, setOpenPickerNodeId] = useState<string | null>(null)

  if (nodes.length === 0) return null

  return (
    <div className="nc-message-timeline" data-testid={workbenchSelectors.timeline}>
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
