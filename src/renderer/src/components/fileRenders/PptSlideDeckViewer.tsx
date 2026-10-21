import { t } from '../../i18n'
import { useOfficeReviewNavigation } from '../workbench/OfficeReviewContext'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { pptAdapter, interactivePptSvg } from './selection/pptAdapter'
import { POINTER_CLICK_THRESHOLD, type SelectionAdapter } from './selection/types'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { HiHandRaised, HiMinus, HiPlus } from 'react-icons/hi2'

export type PptViewerSlide = {
  id: string
  index: number
  svg?: string
  primaryUrl?: string
  secondaryUrl?: string
  label?: string
  marker?: 'added' | 'deleted' | 'modified' | 'moved'
}

type Viewport = { scale: number; x: number; y: number }

const MouseScrollIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="7" y="3" width="10" height="18" rx="5" />
    <path d="M12 6v4" />
  </svg>
)

export type PptSlideDeckViewerProps = {
  slides: PptViewerSlide[]
  loading?: boolean
  error?: string | null
  diff?: boolean
  filter?: { changedOnly: boolean; onChange: (changedOnly: boolean) => void }
  testId?: string
  beforeTestId?: string
  afterTestId?: string
  thumbnailsTestId?: string
  hintTestId?: string
  selectionFilePath?: string
  contentRevision?: string
  emptyText?: string
}

const PptSlideDeckViewer: React.FC<PptSlideDeckViewerProps> = ({
  slides,
  loading = false,
  error = null,
  diff = false,
  filter,
  testId,
  beforeTestId,
  afterTestId,
  thumbnailsTestId,
  hintTestId,
  selectionFilePath,
  contentRevision = '',
  emptyText = t(($) => $.editors.presentationPreviewUnavailable)
}) => {
  const reviewNavigation = useOfficeReviewNavigation()
  const [selectionContainer, setSelectionContainer] = useState<HTMLDivElement | null>(null)
  const spaceRef = useRef(false)
  const [spacePressed, setSpacePressed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hoveringElement, setHoveringElement] = useState(false)
  const panGesture = useRef(false)
  const [activeId, setActiveId] = useState<string | null>(slides[0]?.id || null)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    originX: number
    originY: number
    surface: HTMLDivElement
  } | null>(null)
  const visibleSlides = useMemo(
    () => (filter?.changedOnly ? slides.filter((slide) => slide.marker) : slides),
    [filter, slides]
  )
  const activeIndex = Math.max(
    0,
    visibleSlides.findIndex((slide) => slide.id === activeId)
  )
  const activeSlide = visibleSlides[activeIndex] || visibleSlides[0]
  const activeReviewRegions = useMemo(
    () =>
      new Map(
        reviewNavigation?.index.regions
          .filter((region) => region.surface === activeSlide?.id)
          .map((region) => [region.key, region])
      ),
    [reviewNavigation?.index, activeSlide?.id]
  )
  // Viewport and cursor updates must preserve SVG nodes used by the current pointer gesture.
  const isReview = reviewNavigation !== null
  const [reviewMarkup, setReviewMarkup] = useState<{ before?: string; after?: string }>({})
  useEffect(() => {
    if (!isReview) return
    let cancelled = false
    setReviewMarkup({})
    const load = async (url?: string) =>
      url ? interactivePptSvg(await (await fetch(url)).text()) : undefined
    void Promise.all([load(activeSlide?.primaryUrl), load(activeSlide?.secondaryUrl)])
      .then(([before, after]) => {
        if (!cancelled) setReviewMarkup({ before, after })
      })
      .catch(() => {
        if (!cancelled) setReviewMarkup({})
      })
    return () => {
      cancelled = true
    }
  }, [isReview, activeSlide?.primaryUrl, activeSlide?.secondaryUrl])
  const interactiveMarkup = useMemo(() => ({ __html: activeSlide?.svg || '' }), [activeSlide?.svg])

  React.useEffect(() => {
    if (!visibleSlides.length) return
    if (!visibleSlides.some((slide) => slide.id === activeId)) setActiveId(visibleSlides[0]!.id)
  }, [activeId, visibleSlides])

  const selectSlide = React.useCallback(
    (id: string): boolean => {
      if (!slides.some((slide) => slide.id === id)) return false
      setActiveId(id)
      setViewport({ scale: 1, x: 0, y: 0 })
      return true
    },
    [slides]
  )
  const [selectionAdapter, setSelectionAdapter] = useState<SelectionAdapter | null>(null)
  React.useEffect(() => {
    setSelectionAdapter(
      selectionContainer && selectionFilePath && activeSlide
        ? pptAdapter(
            selectionContainer,
            selectionFilePath,
            activeSlide,
            contentRevision,
            selectSlide,
            () => panGesture.current
          )
        : null
    )
  }, [selectionContainer, selectionFilePath, activeSlide, contentRevision, selectSlide])
  const finishPan = React.useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (drag?.surface.hasPointerCapture(drag.pointerId))
      drag.surface.releasePointerCapture(drag.pointerId)
  }, [])
  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code === 'Space' &&
        event.target instanceof Element &&
        selectionContainer?.contains(event.target) &&
        !event.target.closest('button,input,textarea,[contenteditable="true"]')
      ) {
        event.preventDefault()
        spaceRef.current = true
        setSpacePressed(true)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceRef.current = false
      setSpacePressed(false)
    }
    const blur = () => {
      spaceRef.current = false
      setSpacePressed(false)
      if (dragRef.current) panGesture.current = true
      finishPan()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [selectionContainer, finishPan])
  const resetViewport = (): void => {
    setViewport({ scale: 1, x: 0, y: 0 })
  }
  const changeZoom = (factor: number): void => {
    setViewport((current) => {
      const scale = Math.min(4, Math.max(0.25, current.scale * factor))
      return { ...current, scale }
    })
  }
  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - rect.left - rect.width / 2
    const pointerY = event.clientY - rect.top - rect.height / 2
    const factor = event.deltaY < 0 ? 1.12 : 0.89
    setViewport((current) => {
      const scale = Math.min(4, Math.max(0.25, current.scale * factor))
      const ratio = scale / current.scale
      return {
        scale,
        x: current.x + (pointerX - current.x) * (1 - ratio),
        y: current.y + (pointerY - current.y) * (1 - ratio)
      }
    })
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 1) return
    panGesture.current = spaceRef.current || event.button === 1
    // Native SVG text/image dragging must never compete with canvas navigation.
    event.preventDefault()
    selectionContainer?.focus({ preventScroll: true })
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      surface: event.currentTarget
    }
  }
  const reviewRegionAt = (element: Element | null) => {
    const key = element?.closest('[data-nc-shape-id]')?.getAttribute('data-nc-shape-id') || 'slide'
    return activeReviewRegions.get(key) || activeReviewRegions.get('slide')
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = event.target instanceof Element ? event.target : null
    setHoveringElement(
      Boolean(
        (selectionFilePath && element?.closest('[data-nc-shape-id]')) ||
        (reviewNavigation?.enabled && reviewRegionAt(element))
      )
    )
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > POINTER_CLICK_THRESHOLD)
      panGesture.current = true
    if (!panGesture.current) return
    event.preventDefault()
    setDragging(true)
    if (!event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.setPointerCapture(event.pointerId)
    setViewport((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y
    }))
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture')
      panGesture.current = true
    const click = !panGesture.current && event.button === 0
    if (click && reviewNavigation?.enabled && activeSlide) {
      const region = reviewRegionAt(document.elementFromPoint(event.clientX, event.clientY))
      if (region) reviewNavigation.navigate(region.id)
    }
    finishPan()
    setHoveringElement(
      !!selectionFilePath &&
        !!document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-nc-shape-id]')
    )
  }

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  if (error || !slides.length)
    return (
      <div className="flex h-full items-center justify-center">
        <Empty description={error || emptyText} />
      </div>
    )

  const surface = (url: string | undefined, label?: string, testId?: string) => (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 select-none items-center justify-center overflow-hidden bg-[#F4F4F2] p-3"
      style={{
        cursor: dragging ? 'grabbing' : hoveringElement && !spacePressed ? 'pointer' : 'grab'
      }}
      data-testid={testId}
      onWheel={onWheel}
      onPointerDownCapture={onPointerDown}
      onPointerMoveCapture={onPointerMove}
      onPointerUpCapture={onPointerUp}
      onPointerCancelCapture={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onPointerLeave={() => {
        if (!dragRef.current) setHoveringElement(false)
      }}
      onDoubleClick={selectionFilePath ? undefined : resetViewport}
    >
      {label ? (
        <span className="pointer-events-none absolute left-3 top-2 z-10 rounded-[3px] bg-white/90 px-1.5 py-0.5 text-[10px] text-[#787774]">
          {label}
        </span>
      ) : null}
      {url ? (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: 'center center',
            willChange: 'transform'
          }}
        >
          {reviewNavigation &&
          (label === t(($) => $.editors.before)
            ? reviewMarkup.before
            : reviewMarkup.after || reviewMarkup.before) ? (
            <div
              className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{
                __html:
                  (label === t(($) => $.editors.before)
                    ? reviewMarkup.before
                    : reviewMarkup.after || reviewMarkup.before) || ''
              }}
            />
          ) : selectionFilePath && activeSlide?.svg ? (
            <div
              data-ppt-interactive
              className="h-full w-full [&>svg]:h-full [&>svg]:w-full [&>svg]:select-none"
              onClick={(event) => event.preventDefault()}
              dangerouslySetInnerHTML={interactiveMarkup}
            />
          ) : (
            <img
              src={url}
              className="block max-h-full max-w-full border border-[#DEDCD8] bg-white object-contain shadow-sm"
              draggable={false}
            />
          )}
        </div>
      ) : (
        <div className="aspect-video w-full max-w-[960px] border border-dashed border-[#D8D6D1] bg-white" />
      )}
    </div>
  )

  return (
    <div
      className="flex h-full w-full min-h-0 bg-white"
      data-testid={testId}
      ref={setSelectionContainer}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && dragRef.current) {
          panGesture.current = true
          finishPan()
          event.preventDefault()
          return
        }
        if (
          event.shiftKey ||
          (event.target instanceof Element &&
            event.target.closest('input,textarea,[contenteditable="true"]'))
        )
          return
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const next =
          visibleSlides[
            Math.max(
              0,
              Math.min(visibleSlides.length - 1, activeIndex + (event.key === 'ArrowLeft' ? -1 : 1))
            )
          ]
        if (next) selectSlide(next.id)
      }}
    >
      {selectionAdapter && selectionFilePath && (
        <DocumentSelectionLayer
          container={selectionContainer}
          filePath={selectionFilePath}
          revision={contentRevision}
          adapter={selectionAdapter}
          testPrefix="ppt"
          manageCursor={false}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-[#E7E5E1] bg-white px-2">
          {selectionFilePath && (
            <button
              type="button"
              data-ppt-reference-page
              data-selection-trigger
              className="mr-auto rounded px-2 py-1 text-xs text-[#80649F] hover:bg-[#F3EDF9]"
            >
              {t(($) => $.editors.referenceThisSlide)}
            </button>
          )}
          <button
            type="button"
            title={t(($) => $.common.zoomOut)}
            aria-label={t(($) => $.common.zoomOut)}
            className="rounded p-1 text-[#787774] hover:bg-[#F4F4F2]"
            onClick={() => changeZoom(0.8)}
          >
            <HiMinus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t(($) => $.editors.fitToWindow)}
            aria-label={t(($) => $.editors.fitToWindow)}
            className="min-w-[48px] rounded px-1.5 py-0.5 text-[11px] text-[#787774] hover:bg-[#F4F4F2]"
            onClick={resetViewport}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            title={t(($) => $.common.zoomIn)}
            aria-label={t(($) => $.common.zoomIn)}
            className="rounded p-1 text-[#787774] hover:bg-[#F4F4F2]"
            onClick={() => changeZoom(1.25)}
          >
            <HiPlus className="h-4 w-4" />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1">
          {diff ? (
            <div className="flex min-w-0 flex-1 divide-x divide-[#E7E5E1]">
              {surface(
                activeSlide?.primaryUrl,
                t(($) => $.editors.before),
                beforeTestId
              )}
              {surface(
                activeSlide?.secondaryUrl,
                t(($) => $.editors.after),
                afterTestId
              )}
            </div>
          ) : (
            surface(activeSlide?.primaryUrl || activeSlide?.secondaryUrl, undefined, afterTestId)
          )}
          <div
            className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex w-max -translate-x-1/2 whitespace-nowrap items-center gap-3 rounded-full border border-[#E7E5E1] bg-white/90 px-3 py-1.5 text-[11px] text-[#787774] shadow-[0_8px_24px_rgba(15,15,15,0.08)]"
            data-testid={hintTestId}
          >
            {selectionFilePath && <span>{t(($) => $.editors.clickAnElementToReferenceIt)}</span>}
            {selectionFilePath && <span className="h-3 w-px bg-[#E7E5E1]" />}
            <span className="flex items-center gap-1.5">
              <MouseScrollIcon />
              <span>{t(($) => $.editors.scrollToZoom)}</span>
            </span>
            <span className="h-3 w-px bg-[#E7E5E1]" />
            <span className="flex items-center gap-1.5">
              <HiHandRaised className="h-4 w-4" />
              <span>{t(($) => $.editors.dragToPan)}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex w-[136px] shrink-0 flex-col border-l border-[#E7E5E1] bg-[#FAFAF9]">
        {filter ? (
          <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 border-b border-[#E7E5E1] p-1">
            <button
              type="button"
              aria-label={t(($) => $.editors.showChangedSlidesOnly)}
              className={`rounded px-2 py-1 text-[11px] ${filter.changedOnly ? 'bg-[#E9E7E3] font-medium text-[#37352F]' : 'text-[#9B9A97]'}`}
              onClick={() => filter.onChange(true)}
            >
              {t(($) => $.editors.changes)}
            </button>
            <button
              type="button"
              aria-label={t(($) => $.editors.showAllSlides)}
              className={`rounded px-2 py-1 text-[11px] ${!filter.changedOnly ? 'bg-[#E9E7E3] font-medium text-[#37352F]' : 'text-[#9B9A97]'}`}
              onClick={() => filter.onChange(false)}
            >
              {t(($) => $.common.all)}
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid={thumbnailsTestId}>
          <div className="space-y-2">
            {visibleSlides.map((slide) => (
              <button
                key={slide.id}
                type="button"
                aria-label={t(($) => $.editors.slide, {
                  value1: slide.index,
                  value2: slide.label ? `：${slide.label}` : ''
                })}
                className={`relative block box-border w-full overflow-hidden rounded border-2 bg-white ${slide.id === activeSlide?.id ? 'border-[#37352F]' : 'border-transparent'}`}
                onClick={() => selectSlide(slide.id)}
              >
                {slide.primaryUrl || slide.secondaryUrl ? (
                  <img
                    src={slide.secondaryUrl || slide.primaryUrl}
                    className="aspect-video w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="block aspect-video w-full bg-white" />
                )}
                <span className="absolute bottom-0.5 left-1 rounded bg-black/60 px-1 text-[9px] text-white">
                  {slide.index}
                </span>
                {slide.marker ? (
                  <span
                    title={slide.label}
                    aria-label={slide.label}
                    className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${slide.marker === 'deleted' ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`}
                  />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PptSlideDeckViewer
