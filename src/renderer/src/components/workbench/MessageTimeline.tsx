import React, { useState } from 'react'
import type { TimelineExpansion, TimelineNode } from '../../../../shared/workbench/messageTimeline'
import { workbenchSelectors } from '../../testing/selectors'

type MessageTimelineProps = {
  nodes: TimelineNode[]
  activeNodeId: string | null
  expansion: TimelineExpansion
  onSelectNode: (node: TimelineNode) => void
  onCollapse: () => void
}

export const MessageTimeline = ({
  nodes,
  activeNodeId,
  expansion,
  onSelectNode,
  onCollapse
}: MessageTimelineProps): React.JSX.Element | null => {
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null)

  if (nodes.length === 0) return null

  const expanded =
    expansion.kind === 'month'
      ? { level: 'month' as const, rangeStart: expansion.monthStart }
      : expansion.kind === 'year'
        ? { level: 'year' as const, rangeStart: expansion.yearStart }
        : null

  const compact = nodes.length <= 3
  const single = nodes.length === 1

  return (
    <div
      className={`nc-message-timeline${compact ? ' is-compact' : ''}${single ? ' is-single' : ''}`}
      data-testid={workbenchSelectors.timeline}
    >
      <div className="nc-message-timeline-nodes">
        {single ? null : <div className="nc-message-timeline-fade-up" aria-hidden="true" />}
        {nodes.map((node) => {
          const isActive = node.id === activeNodeId
          const isSegment = node.role === 'segment'
          const showCollapse =
            isSegment &&
            expanded != null &&
            node.level === expanded.level &&
            node.rangeStart === expanded.rangeStart &&
            hoveredSegmentId === node.id

          return (
            <div
              key={node.id}
              className={`nc-message-timeline-row nc-message-timeline-row-${node.level}${
                isSegment ? ' is-segment' : ''
              }${isActive ? ' is-active' : ''}`}
              onMouseEnter={() => {
                if (isSegment) setHoveredSegmentId(node.id)
              }}
              onMouseLeave={() => {
                if (hoveredSegmentId === node.id) setHoveredSegmentId(null)
              }}
            >
              <button
                type="button"
                className="nc-message-timeline-item"
                data-testid={`${workbenchSelectors.timelineItemPrefix}-${node.id}`}
                onClick={() => onSelectNode(node)}
              >
                <span className="nc-message-timeline-track" aria-hidden="true">
                  <span
                    className={`nc-message-timeline-dot nc-message-timeline-dot-${node.level}${
                      isSegment ? ' is-segment' : ''
                    }`}
                  />
                </span>
                <span className="nc-message-timeline-label">{node.label}</span>
              </button>
              {showCollapse ? (
                <button
                  type="button"
                  className="nc-message-timeline-collapse"
                  data-testid={`${workbenchSelectors.timelineItemPrefix}-collapse`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCollapse()
                  }}
                >
                  收起
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
