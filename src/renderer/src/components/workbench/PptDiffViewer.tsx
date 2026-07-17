import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { HiArrowsUpDown, HiFunnel, HiMinus, HiPlus, HiSquares2X2 } from 'react-icons/hi2'
import type { AiFileChangeRecord } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

type DiffFrame = { index: number; image: string }
type DiffSlide = {
  slideId: string
  changed: boolean
  before?: DiffFrame
  after?: DiffFrame
}
type DiffManifest = { version: 1; slides: DiffSlide[] }

const loadLocalUrl = async (filePath: string): Promise<string> => {
  const bytes = await window.api.readFile(filePath)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return URL.createObjectURL(new Blob([buffer], { type: 'image/png' }))
}

const SlideSurface: React.FC<{ imageUrl?: string; side: 'before' | 'after' }> = ({
  imageUrl,
  side
}) => (
  <div
    className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#F4F4F2] p-3"
    data-testid={
      side === 'before' ? workbenchSelectors.pptDiffBefore : workbenchSelectors.pptDiffAfter
    }
  >
    {imageUrl ? (
      <img
        src={imageUrl}
        className="max-h-full max-w-full border border-[#DEDCD8] bg-white object-contain shadow-sm"
        draggable={false}
      />
    ) : (
      <div className="aspect-video w-full max-w-[720px] border border-dashed border-[#D8D6D1] bg-white" />
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
  const wheelLockRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setManifest(null)
    if (!record.previewPath) {
      setLoading(false)
      setError('缺少 PPT 差异预览')
      return
    }
    void window.api
      .readFile(record.previewPath)
      .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as DiffManifest)
      .then((next) => {
        if (cancelled) return
        setManifest(next)
        const first = next.slides.find((slide) => slide.changed) || next.slides[0]
        setActiveSlideId(first?.slideId || null)
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
          .filter(Boolean)
      )
    ] as string[]
    const created: string[] = []
    void Promise.all(
      paths.map(async (filePath) => {
        const url = await loadLocalUrl(filePath)
        created.push(url)
        return [filePath, url] as const
      })
    ).then((entries) => {
      if (cancelled) {
        created.forEach((url) => URL.revokeObjectURL(url))
        return
      }
      setImageUrls(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
      setImageUrls({})
    }
  }, [manifest])

  const visibleSlides = useMemo(
    () => manifest?.slides.filter((slide) => !changedOnly || slide.changed) || [],
    [changedOnly, manifest]
  )
  const activeIndex = Math.max(
    0,
    visibleSlides.findIndex((slide) => slide.slideId === activeSlideId)
  )
  const activeSlide = visibleSlides[activeIndex]

  useEffect(() => {
    if (visibleSlides.length === 0) return
    if (!visibleSlides.some((slide) => slide.slideId === activeSlideId)) {
      setActiveSlideId(visibleSlides[0]!.slideId)
    }
  }, [activeSlideId, visibleSlides])

  const selectOffset = (offset: number): void => {
    if (visibleSlides.length === 0) return
    const nextIndex = Math.max(0, Math.min(visibleSlides.length - 1, activeIndex + offset))
    setActiveSlideId(visibleSlides[nextIndex]!.slideId)
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

  return (
    <div
      className="flex h-full min-h-0 bg-white"
      data-testid={workbenchSelectors.pptDiffViewer}
      onWheel={(event) => {
        if (wheelLockRef.current || Math.abs(event.deltaY) < 12) return
        wheelLockRef.current = true
        selectOffset(event.deltaY > 0 ? 1 : -1)
        window.setTimeout(() => {
          wheelLockRef.current = false
        }, 180)
      }}
    >
      <div className="flex min-w-0 flex-1 divide-x divide-[#E7E5E1]">
        <SlideSurface
          imageUrl={activeSlide?.before ? imageUrls[activeSlide.before.image] : undefined}
          side="before"
        />
        <SlideSurface
          imageUrl={activeSlide?.after ? imageUrls[activeSlide.after.image] : undefined}
          side="after"
        />
      </div>
      <div className="flex w-[116px] shrink-0 flex-col border-l border-[#E7E5E1] bg-[#FAFAF9]">
        <div className="flex h-10 shrink-0 items-center justify-center gap-1 border-b border-[#E7E5E1]">
          <button
            type="button"
            aria-label="只看修改页"
            className={`rounded p-1.5 ${changedOnly ? 'bg-[#E9E7E3] text-[#37352F]' : 'text-[#9B9A97]'}`}
            onClick={() => setChangedOnly(true)}
          >
            <HiFunnel className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="查看全部页"
            className={`rounded p-1.5 ${!changedOnly ? 'bg-[#E9E7E3] text-[#37352F]' : 'text-[#9B9A97]'}`}
            onClick={() => setChangedOnly(false)}
          >
            <HiSquares2X2 className="h-4 w-4" />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-2"
          data-testid={workbenchSelectors.pptDiffThumbnails}
        >
          <div className="space-y-2">
            {visibleSlides.map((slide) => {
              const frame = slide.after || slide.before
              const selected = slide.slideId === activeSlide?.slideId
              const added = !slide.before && Boolean(slide.after)
              const deleted = Boolean(slide.before) && !slide.after
              const moved = Boolean(
                slide.before && slide.after && slide.before.index !== slide.after.index
              )
              return (
                <button
                  key={slide.slideId}
                  type="button"
                  className={`relative block w-full overflow-hidden rounded border-2 bg-white ${
                    selected
                      ? 'border-[#37352F]'
                      : slide.changed
                        ? 'border-[#C7A96B]'
                        : 'border-transparent'
                  }`}
                  onClick={() => setActiveSlideId(slide.slideId)}
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
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/95 text-[#37352F] shadow-sm">
                    {added ? (
                      <HiPlus className="h-3 w-3 text-[#147A3D]" />
                    ) : deleted ? (
                      <HiMinus className="h-3 w-3 text-[#B42318]" />
                    ) : moved ? (
                      <HiArrowsUpDown className="h-3 w-3" />
                    ) : slide.changed ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#C18B25]" />
                    ) : null}
                  </span>
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
