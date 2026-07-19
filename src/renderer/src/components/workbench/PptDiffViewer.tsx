import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { HiMinus, HiPlus } from 'react-icons/hi2'
import type { AiFileChangeRecord } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

type DiffFrame = { index: number; image: string }
type DiffSlide = {
  slideId: string
  changed: boolean
  changes: Array<'added' | 'deleted' | 'modified' | 'moved'>
  before?: DiffFrame
  after?: DiffFrame
}
type DiffManifest = { version: 2; operation: 'created' | 'updated'; slides: DiffSlide[] }
type Viewport = { scale: number; x: number; y: number }

const loadLocalUrl = async (filePath: string): Promise<string> => {
  const bytes = await window.api.readFile(filePath)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
}

const changeLabel = (changes: DiffSlide['changes']): string => {
  if (changes.includes('deleted')) return '已删除'
  if (changes.includes('added')) return '新增页'
  if (changes.includes('moved') && changes.includes('modified')) return '内容已修改，位置已移动'
  if (changes.includes('moved')) return '位置已移动'
  if (changes.includes('modified')) return '内容已修改'
  return ''
}

const SlideSurface: React.FC<{
  imageUrl?: string
  side: 'before' | 'after'
  showSideLabel?: boolean
  viewport: Viewport
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}> = ({
  imageUrl,
  side,
  showSideLabel = true,
  viewport,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick
}) => (
  <div
    className={`relative flex min-h-0 min-w-0 flex-1 select-none items-center justify-center overflow-hidden bg-[#F4F4F2] p-3 ${viewport.scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
    data-testid={
      side === 'before' ? workbenchSelectors.pptDiffBefore : workbenchSelectors.pptDiffAfter
    }
    onWheel={onWheel}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
    onDoubleClick={onDoubleClick}
  >
    {showSideLabel ? (
      <span className="pointer-events-none absolute left-3 top-2 z-10 rounded-[3px] bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-[#787774] shadow-sm">
        {side === 'before' ? '修改前' : '修改后'}
      </span>
    ) : null}
    {imageUrl ? (
      <div
        className="flex h-full w-full items-center justify-center"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: 'center center',
          willChange: 'transform'
        }}
      >
        <img
          src={imageUrl}
          className="block max-h-full max-w-full border border-[#DEDCD8] bg-white object-contain shadow-sm"
          draggable={false}
        />
      </div>
    ) : (
      <div className="flex h-full w-full items-center justify-center">
        <div className="aspect-video w-full max-w-[960px] border border-dashed border-[#D8D6D1] bg-white" />
      </div>
    )}
  </div>
)

const PptDiffViewer: React.FC<{ record: AiFileChangeRecord }> = ({ record }) => {
  const [manifest, setManifest] = useState<DiffManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changedOnly, setChangedOnly] = useState(true)
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    originX: number
    originY: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setManifest(null)
    if (!record.previewPath) {
      setLoading(false)
      setError('缺少 PPT 差异预览。')
      return
    }
    void window.api
      .readFile(record.previewPath)
      .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as DiffManifest)
      .then((next) => {
        if (cancelled) return
        if (next.version !== 2 || !Array.isArray(next.slides)) {
          throw new Error('该 PPT 预览版本已过期，请重新生成修改记录。')
        }
        setManifest(next)
        setChangedOnly(next.operation === 'updated')
        const first = next.slides.find((slide) => slide.changed) || next.slides[0]
        setActiveSlideId(first?.slideId || null)
        setViewport({ scale: 1, x: 0, y: 0 })
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [record.id, record.previewPath])

  useEffect(() => {
    if (!manifest) return
    let cancelled = false
    const paths = [
      ...new Set(
        manifest.slides
          .flatMap((slide) => [slide.before?.image, slide.after?.image])
          .filter((value): value is string => Boolean(value))
      )
    ]
    const created: string[] = []
    void Promise.all(
      paths.map(async (filePath) => {
        const url = await loadLocalUrl(filePath)
        created.push(url)
        return [filePath, url] as const
      })
    )
      .then((entries) => {
        if (!cancelled) setImageUrls(Object.fromEntries(entries))
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
      setImageUrls({})
    }
  }, [manifest])

  const hasUnchangedSlides = Boolean(manifest?.slides.some((slide) => !slide.changed))
  const showFilter = manifest?.operation === 'updated' && hasUnchangedSlides
  const visibleSlides = useMemo(() => {
    if (!manifest) return []
    if (manifest.operation === 'created' || !showFilter || !changedOnly) return manifest.slides
    return manifest.slides.filter((slide) => slide.changed)
  }, [changedOnly, manifest, showFilter])
  const activeIndex = Math.max(
    0,
    visibleSlides.findIndex((slide) => slide.slideId === activeSlideId)
  )
  const activeSlide = visibleSlides[activeIndex]

  useEffect(() => {
    if (!visibleSlides.length) return
    if (!visibleSlides.some((slide) => slide.slideId === activeSlideId)) {
      setActiveSlideId(visibleSlides[0]!.slideId)
      setViewport({ scale: 1, x: 0, y: 0 })
    }
  }, [activeSlideId, visibleSlides])

  const changeViewport = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    const rect = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - rect.left - rect.width / 2
    const pointerY = event.clientY - rect.top - rect.height / 2
    setViewport((current) => {
      const nextScale = Math.min(4, Math.max(0.25, current.scale * (direction > 0 ? 1.12 : 0.89)))
      if (nextScale === current.scale) return current
      if (nextScale <= 1) return { scale: nextScale, x: 0, y: 0 }
      const ratio = nextScale / current.scale
      const rawX = current.x + (pointerX - current.x) * (1 - ratio)
      const rawY = current.y + (pointerY - current.y) * (1 - ratio)
      const maxX = rect.width > 0 ? (rect.width * (nextScale - 1)) / 2 : Number.POSITIVE_INFINITY
      const maxY = rect.height > 0 ? (rect.height * (nextScale - 1)) / 2 : Number.POSITIVE_INFINITY
      return {
        scale: nextScale,
        x: Math.max(-maxX, Math.min(maxX, rawX)),
        y: Math.max(-maxY, Math.min(maxY, rawY))
      }
    })
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
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

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    setViewport((current) => {
      const maxX =
        rect.width > 0 ? (rect.width * (current.scale - 1)) / 2 : Number.POSITIVE_INFINITY
      const maxY =
        rect.height > 0 ? (rect.height * (current.scale - 1)) / 2 : Number.POSITIVE_INFINITY
      return {
        ...current,
        x: Math.max(-maxX, Math.min(maxX, drag.originX + event.clientX - drag.x)),
        y: Math.max(-maxY, Math.min(maxY, drag.originY + event.clientY - drag.y))
      }
    })
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const selectSlide = (slideId: string): void => {
    setActiveSlideId(slideId)
    setViewport({ scale: 1, x: 0, y: 0 })
  }

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  if (error || !manifest) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty description={error || 'PPT 暂时无法预览'} />
      </div>
    )
  }

  const beforeUrl = activeSlide?.before ? imageUrls[activeSlide.before.image] : undefined
  const afterUrl = activeSlide?.after ? imageUrls[activeSlide.after.image] : undefined
  const resetViewport = (): void => setViewport({ scale: 1, x: 0, y: 0 })
  const changeZoom = (factor: number): void => {
    setViewport((current) => {
      const scale = Math.min(4, Math.max(0.25, current.scale * factor))
      return scale <= 1 ? { scale, x: 0, y: 0 } : { ...current, scale }
    })
  }

  return (
    <div
      className="flex h-full min-h-0 bg-white"
      data-testid={workbenchSelectors.pptDiffViewer}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const offset = event.key === 'ArrowLeft' ? -1 : 1
        const next =
          visibleSlides[Math.max(0, Math.min(visibleSlides.length - 1, activeIndex + offset))]
        if (next) selectSlide(next.slideId)
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
        <div className="flex min-h-0 flex-1">
          {manifest.operation === 'updated' ? (
            <div className="flex min-w-0 flex-1 divide-x divide-[#E7E5E1]">
              <SlideSurface
                imageUrl={beforeUrl}
                side="before"
                viewport={viewport}
                onWheel={changeViewport}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onDoubleClick={resetViewport}
              />
              <SlideSurface
                imageUrl={afterUrl}
                side="after"
                viewport={viewport}
                onWheel={changeViewport}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onDoubleClick={resetViewport}
              />
            </div>
          ) : (
            <SlideSurface
              imageUrl={afterUrl}
              side="after"
              showSideLabel={false}
              viewport={viewport}
              onWheel={changeViewport}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onDoubleClick={resetViewport}
            />
          )}
        </div>
      </div>
      <div className="flex w-[136px] shrink-0 flex-col border-l border-[#E7E5E1] bg-[#FAFAF9]">
        {showFilter ? (
          <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 border-b border-[#E7E5E1] p-1">
            <button
              type="button"
              aria-label="只看变更页"
              className={`rounded px-2 py-1 text-[11px] ${changedOnly ? 'bg-[#E9E7E3] font-medium text-[#37352F]' : 'text-[#9B9A97]'}`}
              onClick={() => setChangedOnly(true)}
            >
              变更
            </button>
            <button
              type="button"
              aria-label="查看全部页"
              className={`rounded px-2 py-1 text-[11px] ${!changedOnly ? 'bg-[#E9E7E3] font-medium text-[#37352F]' : 'text-[#9B9A97]'}`}
              onClick={() => setChangedOnly(false)}
            >
              全部
            </button>
          </div>
        ) : null}
        <div
          className="min-h-0 flex-1 overflow-y-auto p-2"
          data-testid={workbenchSelectors.pptDiffThumbnails}
        >
          <div className="space-y-2">
            {visibleSlides.map((slide) => {
              const frame = slide.after || slide.before
              const selected = slide.slideId === activeSlide?.slideId
              const label = changeLabel(slide.changes)
              const deleted = slide.changes.includes('deleted')
              return (
                <button
                  key={slide.slideId}
                  type="button"
                  aria-label={`第 ${slide.after?.index || slide.before?.index || 0} 页${label ? `，${label}` : ''}`}
                  className={`relative block box-border w-full overflow-hidden rounded border-2 bg-white ${selected ? 'border-[#37352F]' : 'border-transparent'}`}
                  onClick={() => selectSlide(slide.slideId)}
                >
                  {frame && imageUrls[frame.image] ? (
                    <img
                      src={imageUrls[frame.image]}
                      className={`aspect-video w-full object-cover ${deleted ? 'opacity-55' : ''}`}
                      draggable={false}
                    />
                  ) : (
                    <span className="block aspect-video w-full bg-white" />
                  )}
                  <span className="absolute bottom-0.5 left-1 rounded bg-black/60 px-1 text-[9px] text-white">
                    {slide.after?.index || slide.before?.index}
                  </span>
                  {manifest.operation === 'updated' && label ? (
                    <span
                      title={label}
                      aria-label={label}
                      className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${deleted ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PptDiffViewer
