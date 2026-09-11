import React, { useMemo, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { HiHandRaised, HiMinus, HiPlus } from 'react-icons/hi2'

export type PptViewerSlide = {
  id: string
  index: number
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
  emptyText?: string
}

const clampOffset = (value: number, size: number, scale: number): number => {
  const max = size > 0 ? (size * (scale - 1)) / 2 : Number.POSITIVE_INFINITY
  return Math.max(-max, Math.min(max, value))
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
  emptyText = 'PPT 暂时无法预览'
}) => {
  const [activeId, setActiveId] = useState<string | null>(slides[0]?.id || null)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    originX: number
    originY: number
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

  React.useEffect(() => {
    if (!visibleSlides.length) return
    if (!visibleSlides.some((slide) => slide.id === activeId)) setActiveId(visibleSlides[0]!.id)
  }, [activeId, visibleSlides])

  const selectSlide = (id: string): void => {
    setActiveId(id)
    setViewport({ scale: 1, x: 0, y: 0 })
  }
  const resetViewport = (): void => {
    setViewport({ scale: 1, x: 0, y: 0 })
  }
  const changeZoom = (factor: number): void => {
    setViewport((current) => {
      const scale = Math.min(4, Math.max(0.25, current.scale * factor))
      return scale <= 1 ? { scale, x: 0, y: 0 } : { ...current, scale }
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
      if (scale <= 1) return { scale, x: 0, y: 0 }
      const ratio = scale / current.scale
      return {
        scale,
        x: clampOffset(current.x + (pointerX - current.x) * (1 - ratio), rect.width, scale),
        y: clampOffset(current.y + (pointerY - current.y) * (1 - ratio), rect.height, scale)
      }
    })
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (viewport.scale <= 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: viewport.x,
      originY: viewport.y
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    setViewport((current) => ({
      ...current,
      x: clampOffset(drag.originX + event.clientX - drag.x, rect.width, current.scale),
      y: clampOffset(drag.originY + event.clientY - drag.y, rect.height, current.scale)
    }))
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
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
      className={`relative flex min-h-0 min-w-0 flex-1 select-none items-center justify-center overflow-hidden bg-[#F4F4F2] p-3 ${viewport.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
      data-testid={testId}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={resetViewport}
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
          <img
            src={url}
            className="block max-h-full max-w-full border border-[#DEDCD8] bg-white object-contain shadow-sm"
            draggable={false}
          />
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
      tabIndex={0}
      onKeyDown={(event) => {
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
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-[#E7E5E1] bg-white px-2">
          <button
            type="button"
            title="缩小"
            aria-label="缩小"
            className="rounded p-1 text-[#787774] hover:bg-[#F4F4F2]"
            onClick={() => changeZoom(0.8)}
          >
            <HiMinus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="适应窗口"
            aria-label="适应窗口"
            className="min-w-[48px] rounded px-1.5 py-0.5 text-[11px] text-[#787774] hover:bg-[#F4F4F2]"
            onClick={resetViewport}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            title="放大"
            aria-label="放大"
            className="rounded p-1 text-[#787774] hover:bg-[#F4F4F2]"
            onClick={() => changeZoom(1.25)}
          >
            <HiPlus className="h-4 w-4" />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1">
          {diff ? (
            <div className="flex min-w-0 flex-1 divide-x divide-[#E7E5E1]">
              {surface(activeSlide?.primaryUrl, '修改前', beforeTestId)}
              {surface(activeSlide?.secondaryUrl, '修改后', afterTestId)}
            </div>
          ) : (
            surface(activeSlide?.primaryUrl || activeSlide?.secondaryUrl, undefined, afterTestId)
          )}
          <div
            className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#E7E5E1] bg-white/90 px-3 py-1.5 text-[11px] text-[#787774] shadow-[0_8px_24px_rgba(15,15,15,0.08)]"
            data-testid={hintTestId}
          >
            <span className="flex items-center gap-1.5">
              <MouseScrollIcon />
              <span>滚轮缩放</span>
            </span>
            <span className="h-3 w-px bg-[#E7E5E1]" />
            <span className="flex items-center gap-1.5">
              <HiHandRaised className="h-4 w-4" />
              <span>拖拽平移</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex w-[136px] shrink-0 flex-col border-l border-[#E7E5E1] bg-[#FAFAF9]">
        {filter ? (
          <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 border-b border-[#E7E5E1] p-1">
            <button
              type="button"
              aria-label="只看变更页"
              className={`rounded px-2 py-1 text-[11px] ${filter.changedOnly ? 'bg-[#E9E7E3] font-medium text-[#37352F]' : 'text-[#9B9A97]'}`}
              onClick={() => filter.onChange(true)}
            >
              变更
            </button>
            <button
              type="button"
              aria-label="查看全部页"
              className={`rounded px-2 py-1 text-[11px] ${!filter.changedOnly ? 'bg-[#E9E7E3] font-medium text-[#37352F]' : 'text-[#9B9A97]'}`}
              onClick={() => filter.onChange(false)}
            >
              全部
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid={thumbnailsTestId}>
          <div className="space-y-2">
            {visibleSlides.map((slide) => (
              <button
                key={slide.id}
                type="button"
                aria-label={`第 ${slide.index} 页${slide.label ? `：${slide.label}` : ''}`}
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
