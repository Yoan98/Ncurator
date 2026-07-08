import React, { useEffect, useMemo, useRef, useState } from 'react'
import { HiArrowDownTray, HiMinus, HiPlus, HiXMark } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'

export type ImageLightboxImage = {
  name: string
  src: string
}

type ImageLightboxProps = {
  image: ImageLightboxImage | null
  onClose: () => void
}

const clampScale = (value: number): number => Math.max(0.25, Math.min(4, value))

const ImageLightbox: React.FC<ImageLightboxProps> = ({ image, onClose }) => {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    startX: number
    startY: number
  } | null>(null)

  useEffect(() => {
    if (!image) return
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [image])

  useEffect(() => {
    if (!image) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [image, onClose])

  const scaleLabel = useMemo(() => `${Math.round(scale * 100)}%`, [scale])

  if (!image) return null

  const updateScale = (nextScale: number): void => {
    setScale(clampScale(nextScale))
  }

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden bg-[#111111]/95"
      data-testid={workbenchSelectors.attachmentPreviewModal}
      onWheel={(event) => {
        event.preventDefault()
        updateScale(scale + (event.deltaY > 0 ? -0.1 : 0.1))
      }}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-default"
        aria-label="关闭图片预览背景"
        onClick={onClose}
      />

      <div className="absolute right-5 top-5 z-[2] flex items-center gap-3">
        <a
          href={image.src}
          download={image.name}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#2F3437] shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition hover:bg-[#F4F4F2]"
          aria-label="下载图片"
          title="下载"
        >
          <HiArrowDownTray className="h-5 w-5" />
        </a>
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#2F3437] shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition hover:bg-[#F4F4F2]"
          aria-label="关闭图片预览"
          title="关闭"
          onClick={onClose}
        >
          <HiXMark className="h-6 w-6" />
        </button>
      </div>

      <div className="relative z-[1] flex h-full w-full items-center justify-center px-6 pb-24 pt-20">
        <div className="flex h-full w-full items-center justify-center overflow-hidden">
          <img
            src={image.src}
            alt={image.name}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > 1 ? 'grab' : 'default',
              transition: dragging ? 'none' : 'transform 120ms ease-out'
            }}
            onPointerDown={(event) => {
              if (scale <= 1) return
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                startX: offset.x,
                startY: offset.y
              }
              setDragging(true)
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              setOffset({
                x: drag.startX + event.clientX - drag.x,
                y: drag.startY + event.clientY - drag.y
              })
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                dragRef.current = null
                setDragging(false)
              }
            }}
            onPointerCancel={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) {
                dragRef.current = null
                setDragging(false)
              }
            }}
          />
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 z-[2] flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-2 py-1.5 text-[#2F3437] shadow-[0_10px_28px_rgba(0,0,0,0.32)]">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#F4F4F2]"
          aria-label="缩小"
          onClick={() => updateScale(scale - 0.1)}
        >
          <HiMinus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="min-w-[58px] rounded-full px-2 text-center text-[14px] font-medium leading-9"
          onClick={() => {
            setScale(1)
            setOffset({ x: 0, y: 0 })
          }}
        >
          {scaleLabel}
        </button>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#F4F4F2]"
          aria-label="放大"
          onClick={() => updateScale(scale + 0.1)}
        >
          <HiPlus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default ImageLightbox
