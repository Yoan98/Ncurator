import { t } from '../../i18n'
import { message } from 'antd'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { workbenchSelectors } from '../../testing/selectors'
import type { SuperDoc } from 'superdoc'
import type { WordReviewMarker, WordSourceParagraph } from './superDocReview'
import type { SelectionRect } from './selection/floatingLayout'
import type { SelectionTarget } from './selection/types'

type MarkerKind = 'reference' | 'inserted' | 'deleted' | 'formatted'
type Target = {
  id: string
  kind: MarkerKind
  label: string
  rects: () => SelectionRect[]
  /** Document-wide ratio, independent of the painted page window and scroll offset. */
  overviewPosition?: () => number | undefined
  reveal?: () => Promise<void>
}
type Marker = { key: string; top: number; bottom: number; targets: Target[] }
type Scrollbar = { top: number; height: number }
type ScrollGesture = {
  pointerId: number
  startY: number
  grabOffset: number
  onThumb: boolean
  dragging: boolean
  marker?: Marker
  button: HTMLButtonElement | null
}
const colors = {
  reference: '#A480C5',
  inserted: '#2F6F4E',
  deleted: '#B3261E',
  formatted: '#2F6F4E'
}
const changeLabels = {
  inserted: t(($) => $.editors.add),
  deleted: t(($) => $.common.delete),
  formatted: t(($) => $.editors.formattingChanges)
}

function measureScrollbar(container: HTMLElement, height: number): Scrollbar | null {
  const maxScroll = container.scrollHeight - container.clientHeight
  if (maxScroll <= 1 || height <= 0) return null
  const thumbHeight = Math.min(
    height,
    Math.max(24, (height * container.clientHeight) / container.scrollHeight)
  )
  return {
    top: Math.max(0, Math.min(1, container.scrollTop / maxScroll)) * (height - thumbHeight),
    height: thumbHeight
  }
}

function reviewTargets(
  container: HTMLElement,
  editor?: SuperDoc,
  markers: WordReviewMarker[] = [],
  paragraphs: WordSourceParagraph[] = []
): Target[] {
  const painted = [...container.querySelectorAll<HTMLElement>('[data-docx-change]')].flatMap(
    (element, index): Target[] => {
      const kind = element.dataset.docxChange
      if (kind !== 'inserted' && kind !== 'deleted' && kind !== 'formatted') return []
      // A marked paragraph/table already includes same-kind children; keep other kinds.
      if (element.parentElement?.closest(`[data-docx-change="${kind}"]`)) return []
      return [
        {
          id: `change-${index}`,
          kind,
          label: changeLabels[kind],
          rects: () => [...element.getClientRects()]
        }
      ]
    }
  )
  if (!markers.length) return painted
  const body = new Set(paragraphs.filter((p) => p.part === 'word/document.xml').map((p) => p.id))
  const paintedRects = (id: string) =>
    [...container.querySelectorAll<HTMLElement>(`[data-review-region="${CSS.escape(id)}"]`)]
      .flatMap((el) => [...el.getClientRects()])
      .filter((r) => r.width > 0 && r.height > 0)
  return markers.map(
    (marker): Target => ({
      id: marker.id,
      kind: marker.kind,
      label: changeLabels[marker.kind],
      reveal: async () => {
        await editor?.activeEditor?.pageMetrics?.revealBodyTarget({ paraId: marker.paragraphId })
        await new Promise(requestAnimationFrame)
      },
      rects: () => paintedRects(marker.id),
      ...(body.has(marker.paragraphId)
        ? {
            overviewPosition: () => {
              const metrics = editor?.activeEditor?.pageMetrics
              const index = metrics?.pageIndexForBodyTarget({ paraId: marker.paragraphId })
              const pages = metrics?.getSnapshot().pages || []
              const page = index == null ? undefined : pages[index]
              const extent = Math.max(0, ...pages.map((p) => p.viewport.yPx + p.viewport.heightPx))
              if (!page || !extent) return undefined
              // The overview groups body changes by page; activation still uses
              // precise painted ranges. Never replace a page anchor with DOM
              // geometry when scrolling mounts or unmounts its paragraph.
              return (page.viewport.yPx + page.viewport.heightPx / 2) / extent
            }
          }
        : {})
    })
  )
}

function measureMarkers(targets: Target[], container: HTMLElement, height: number): Marker[] {
  const origin = container.getBoundingClientRect().top + container.clientTop
  const scale = height / Math.max(1, container.scrollHeight)
  const items = targets
    .flatMap((target) => {
      let start: number, end: number
      if (target.overviewPosition) {
        const position = target.overviewPosition()
        if (position == null) return []
        start = end = position * height
      } else {
        const rects = target.rects().filter((rect) => rect.width > 0 && rect.height > 0)
        if (!rects.length) return []
        start = (Math.min(...rects.map((r) => r.top)) - origin + container.scrollTop) * scale
        end = (Math.max(...rects.map((r) => r.bottom)) - origin + container.scrollTop) * scale
      }
      const top = Math.max(0, Math.min(Math.max(0, height - 4), start))
      return [
        {
          key: target.id,
          top,
          bottom: Math.min(height, Math.max(top + 4, end)),
          targets: [target]
        }
      ]
    })
    .sort((a, b) => a.top - b.top)
  const result: Marker[] = []
  for (const lane of ['reference', 'deleted', 'positive']) {
    let previous: Marker | undefined
    for (const item of items.filter(({ targets: [target] }) =>
      lane === 'positive'
        ? target.kind === 'inserted' || target.kind === 'formatted'
        : target.kind === lane
    )) {
      if (previous && item.top <= previous.bottom) {
        previous.bottom = Math.max(previous.bottom, item.bottom)
        previous.targets.push(...item.targets)
        previous.key += `:${item.key}`
      } else {
        previous = { ...item, targets: [...item.targets] }
        result.push(previous)
      }
    }
  }
  return result.sort((a, b) => a.top - b.top)
}

export default function DocxOverviewRuler({
  container,
  mode,
  revision,
  references,
  editor,
  reviewMarkers,
  paragraphs
}: {
  container: HTMLDivElement | null
  mode: 'references' | 'changes'
  revision: number
  references: SelectionTarget[]
  editor?: SuperDoc
  reviewMarkers?: WordReviewMarker[]
  paragraphs?: WordSourceParagraph[]
}) {
  const rail = useRef<HTMLDivElement>(null)
  const cycles = useRef(new Map<string, number>())
  const navigation = useRef({ sequence: 0 })
  const gesture = useRef<ScrollGesture | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [scrollbar, setScrollbar] = useState<Scrollbar | null>(null)
  const [dragging, setDragging] = useState(false)
  const [active, setActive] = useState<Target | null>(null)
  const [focusRects, setFocusRects] = useState<SelectionRect[]>([])

  useEffect(() => {
    setActive(null)
    cycles.current.clear()
    gesture.current = null
    setDragging(false)
    const pending = navigation.current
    return () => {
      pending.sequence++
    }
  }, [container, mode])

  useEffect(() => {
    if (!container || !rail.current || !revision) {
      setMarkers([])
      setScrollbar(null)
      return
    }
    let targets =
      mode === 'changes'
        ? reviewTargets(container, editor, reviewMarkers, paragraphs)
        : [...references]
            .sort((a, b) => {
              const first = a.geometry.ranges?.[0],
                second = b.geometry.ranges?.[0]
              return first && second ? first.compareBoundaryPoints(Range.START_TO_START, second) : 0
            })
            .map(({ node, geometry }) => ({
              id: node.id,
              kind: 'reference' as const,
              label: t(($) => $.editors.reference, { value1: node.number }),
              rects: geometry.rects
            }))
    let frame = 0
    let cancelled = false
    const updateScrollbar = () => {
      if (cancelled || !rail.current) return
      const next = measureScrollbar(container, rail.current.clientHeight)
      setScrollbar((previous) =>
        previous?.top === next?.top && previous?.height === next?.height ? previous : next
      )
    }
    const measure = () => {
      if (!cancelled && rail.current) {
        setMarkers(measureMarkers(targets, container, rail.current.clientHeight))
        updateScrollbar()
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(container)
    resize.observe(rail.current)
    const observeContent = () => {
      container
        .querySelectorAll('.superdoc-page, img, table')
        .forEach((element) => resize.observe(element))
    }
    observeContent()
    const mutations = new MutationObserver(() => {
      if (mode === 'changes') targets = reviewTargets(container, editor, reviewMarkers, paragraphs)
      observeContent()
      schedule()
    })
    mutations.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    })
    container.addEventListener('load', schedule, true)
    container.addEventListener('scroll', updateScrollbar)
    document.fonts.addEventListener('loadingdone', schedule)
    void document.fonts.ready.then(() => {
      if (!cancelled) schedule()
    })
    const stopMetrics = editor?.activeEditor?.pageMetrics?.subscribe(schedule)
    measure()
    return () => {
      stopMetrics?.()
      cancelled = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      container.removeEventListener('load', schedule, true)
      container.removeEventListener('scroll', updateScrollbar)
      document.fonts.removeEventListener('loadingdone', schedule)
    }
  }, [container, mode, revision, references, editor, reviewMarkers, paragraphs])

  useEffect(() => {
    const element = rail.current
    if (!container || !element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? container.clientHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : 1
      container.scrollBy({ top: event.deltaY * unit, behavior: 'instant' })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [container])

  useEffect(() => {
    if (!active || !container) {
      setFocusRects([])
      return
    }
    const update = () => {
      const viewport = container.getBoundingClientRect()
      setFocusRects(
        active
          .rects()
          .map((rect) => {
            const top = Math.max(rect.top, viewport.top),
              bottom = Math.min(rect.bottom, viewport.bottom)
            const left = Math.max(rect.left, viewport.left),
              right = Math.min(rect.right, viewport.right)
            return { top, bottom, left, right, width: right - left, height: bottom - top }
          })
          .filter((rect) => rect.width > 0 && rect.height > 0)
      )
    }
    update()
    const timeout = window.setTimeout(() => setActive(null), 700)
    container.addEventListener('scroll', update)
    return () => {
      clearTimeout(timeout)
      container.removeEventListener('scroll', update)
    }
  }, [active, container])

  const activate = async (marker: Marker) => {
    if (!container) return
    const index = cycles.current.get(marker.key) || 0
    const target = marker.targets[index % marker.targets.length]
    cycles.current.set(marker.key, index + 1)
    const request = ++navigation.current.sequence
    try {
      await target.reveal?.()
    } catch {
      if (request === navigation.current.sequence) message.info(t(($) => $.editors.changeNotFound))
      return
    }
    if (request !== navigation.current.sequence || !container.isConnected) return
    const rects = target.rects().filter((rect) => rect.width > 0 && rect.height > 0)
    if (!rects.length) return
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    const offset =
      bottom - top >= container.clientHeight ? 0 : (container.clientHeight - (bottom - top)) / 2
    const left = Math.min(...rects.map((r) => r.left)),
      right = Math.max(...rects.map((r) => r.right))
    const viewport = container.getBoundingClientRect()
    container.scrollTo({
      left:
        left >= viewport.left && right <= viewport.right
          ? container.scrollLeft
          : container.scrollLeft +
            left -
            viewport.left -
            Math.max(0, (viewport.width - (right - left)) / 2),
      top:
        container.scrollTop +
        top -
        container.getBoundingClientRect().top -
        container.clientTop -
        offset,
      behavior: 'instant'
    })
    // A fresh object restarts the emphasis even when clicking the same target again.
    setActive({ ...target })
  }

  const scrollAtPointer = (clientY: number, grabOffset: number) => {
    if (!container || !rail.current) return
    const thumb = measureScrollbar(container, rail.current.clientHeight)
    if (!thumb) return
    const travel = rail.current.clientHeight - thumb.height
    const top = clientY - rail.current.getBoundingClientRect().top - grabOffset
    container.scrollTo({
      top:
        (Math.max(0, Math.min(travel, top)) / Math.max(1, travel)) *
        (container.scrollHeight - container.clientHeight),
      behavior: 'instant'
    })
  }

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!container || event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const element = event.currentTarget
    const thumb = measureScrollbar(container, element.clientHeight)
    const y = event.clientY - element.getBoundingClientRect().top
    const onThumb = !!thumb && y >= thumb.top && y <= thumb.top + thumb.height
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-marker-index]')
        : null
    gesture.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      grabOffset: thumb && onThumb ? y - thumb.top : (thumb?.height || 0) / 2,
      onThumb,
      dragging: false,
      marker: button ? markers[Number(button.dataset.markerIndex)] : undefined,
      button
    }
    element.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!current.dragging && Math.abs(event.clientY - current.startY) > 3) {
      current.dragging = true
      setDragging(true)
    }
    if (current.dragging) scrollAtPointer(event.clientY, current.grabOffset)
  }

  const endGesture = () => {
    gesture.current = null
    setDragging(false)
  }

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    endGesture()
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    if (current.dragging) return
    if (current.marker) {
      current.button?.focus({ preventScroll: true })
      activate(current.marker)
    } else if (!current.onThumb && container) {
      const thumb = measureScrollbar(container, event.currentTarget.clientHeight)
      if (thumb) scrollAtPointer(event.clientY, thumb.height / 2)
    }
  }

  return (
    <div
      ref={rail}
      className="docx-overview relative h-full w-[16px] shrink-0 touch-none select-none bg-[var(--notion-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--notion-accent-blue)]"
      data-testid={workbenchSelectors.docxOverview}
      data-mode={mode}
      data-dragging={dragging}
      role="navigation"
      aria-label={t(($) => $.editors.documentPosition)}
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !container) return
        const steps: Record<string, number> = {
          ArrowUp: -40,
          ArrowDown: 40,
          PageUp: -container.clientHeight,
          PageDown: container.clientHeight,
          Home: -container.scrollHeight,
          End: container.scrollHeight
        }
        if (!(event.key in steps)) return
        event.preventDefault()
        container.scrollBy({ top: steps[event.key], behavior: 'instant' })
      }}
    >
      {markers.map((marker, index) => {
        const kind = marker.targets[0].kind
        const label =
          [...new Set(marker.targets.map((t) => t.label))].join('、') +
          (marker.targets.length > 1
            ? t(($) => $.editors.locationsClickRepeatedlyToCycleThroughThem, {
                value1: marker.targets.length
              })
            : '')
        return (
          <button
            key={marker.key}
            type="button"
            title={label}
            aria-label={label}
            data-testid={workbenchSelectors.docxOverviewMarker}
            data-marker-index={index}
            data-kinds={[...new Set(marker.targets.map((t) => t.kind))].join(' ')}
            className="absolute cursor-pointer rounded-[1px] border-0 p-0 hover:brightness-90 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--notion-accent-blue)]"
            style={{
              top: marker.top,
              height: marker.bottom - marker.top,
              left: kind === 'reference' || kind === 'deleted' ? 1 : 8,
              width: kind === 'reference' ? 13 : 6,
              backgroundColor: colors[kind]
            }}
            onClick={(event) => {
              // Pointer gestures are handled by the shared track; native button
              // activation (Enter/Space and assistive technology) still locates.
              if (event.detail === 0) activate(marker)
            }}
          />
        )
      })}
      {scrollbar && (
        <div
          aria-hidden="true"
          data-testid={workbenchSelectors.docxOverviewThumb}
          className="docx-overview-thumb pointer-events-none absolute left-[1px] w-[14px] rounded-[2px]"
          style={{ top: scrollbar.top, height: scrollbar.height }}
        />
      )}
      {active &&
        createPortal(
          focusRects.map((rect, index) => (
            <div
              key={index}
              aria-hidden="true"
              data-testid={workbenchSelectors.docxOverviewFocus}
              className="pointer-events-none fixed z-40 rounded-[1px]"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                boxShadow: `inset 0 0 0 2px ${colors[active.kind]}`
              }}
            />
          )),
          document.body
        )}
    </div>
  )
}
