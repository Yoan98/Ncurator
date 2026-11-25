import type { OverviewViewport } from './changeOverviewGeometry'
import { useRef, useState, type HTMLAttributes, type RefObject } from 'react'
import './changeOverviewRuler.css'

export interface OverviewMarker {
  key: string
  top: number
  height: number
  tone: 'removed' | 'added' | 'reference'
  label: string
  kinds?: string
}

type Gesture = {
  pointerId: number
  startY: number
  grabOffset: number
  onThumb: boolean
  dragging: boolean
  markerKey: string | null
  button: HTMLButtonElement | null
}

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant: 'scrollbar' | 'overview'
  trackRef: RefObject<HTMLDivElement | null>
  markers: OverviewMarker[]
  viewport: OverviewViewport | null
  onScrollRatio: (ratio: number) => void
  onActivate: (index: number) => void
  markerTestId?: string
  viewportTestId?: string
  markerClassName?: string
  viewportClassName?: string
}

/** The same two-lane change map and viewport handle for memory and document review. */
export default function ChangeOverviewRuler({
  variant,
  trackRef,
  markers,
  viewport,
  onScrollRatio,
  onActivate,
  markerTestId,
  viewportTestId,
  markerClassName = '',
  viewportClassName = '',
  className = '',
  ...attributes
}: Props) {
  const gesture = useRef<Gesture | null>(null)
  const [dragging, setDragging] = useState(false)
  const scrollAt = (clientY: number, offset: number): void => {
    const track = trackRef.current
    if (!track || !viewport) return
    const travel = track.clientHeight - viewport.height
    const position = clientY - track.getBoundingClientRect().top - offset
    onScrollRatio(Math.max(0, Math.min(1, position / Math.max(1, travel))))
  }
  const end = (): void => {
    gesture.current = null
    setDragging(false)
  }
  return (
    <div
      {...attributes}
      ref={trackRef}
      className={`nc-change-overview ${className}`}
      data-variant={variant}
      data-dragging={dragging}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        const y = event.clientY - event.currentTarget.getBoundingClientRect().top
        const onThumb = !!viewport && y >= viewport.top && y <= viewport.top + viewport.height
        const button =
          event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>('[data-marker-index]')
            : null
        gesture.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          grabOffset: viewport && onThumb ? y - viewport.top : (viewport?.height ?? 0) / 2,
          onThumb,
          dragging: false,
          markerKey: button ? (markers[Number(button.dataset.markerIndex)]?.key ?? null) : null,
          button
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const current = gesture.current
        if (!current || current.pointerId !== event.pointerId) return
        if (!current.dragging && Math.abs(event.clientY - current.startY) > 3) {
          current.dragging = true
          setDragging(true)
        }
        if (current.dragging) scrollAt(event.clientY, current.grabOffset)
      }}
      onPointerUp={(event) => {
        const current = gesture.current
        if (!current || current.pointerId !== event.pointerId) return
        end()
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
        if (current.dragging) return
        if (current.markerKey !== null) {
          const index = markers.findIndex((marker) => marker.key === current.markerKey)
          if (index >= 0) {
            current.button?.focus({ preventScroll: true })
            onActivate(index)
          }
        } else if (!current.onThumb) scrollAt(event.clientY, (viewport?.height ?? 0) / 2)
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {viewport && (
        <span
          aria-hidden="true"
          data-testid={viewportTestId}
          className={`nc-change-overview-viewport ${viewportClassName}`}
          style={{ top: viewport.top, height: viewport.height }}
        />
      )}
      {markers.map((marker, index) => (
        <button
          key={marker.key}
          type="button"
          aria-label={marker.label}
          data-testid={markerTestId}
          data-marker-index={index}
          data-kinds={marker.kinds}
          className={`nc-change-overview-marker ${marker.tone} ${markerClassName}`}
          style={{ top: marker.top, height: marker.height }}
          onClick={(event) => {
            if (event.detail === 0) onActivate(index)
          }}
        />
      ))}
    </div>
  )
}
