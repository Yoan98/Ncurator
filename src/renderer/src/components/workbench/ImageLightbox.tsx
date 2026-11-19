import { t } from '../../i18n'
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

/** 遮罩固定深色：图片预览是「暗底浮层」，不随明暗主题变浅。 */
const LIGHTBOX_SCRIM = 'fixed inset-0 z-[9999] overflow-hidden bg-[#111111]/95'

const clampScale = (value: number): number => Math.max(0.25, Math.min(4, value))

/**
 * 图片预览是「暗底浮层」，它自己的控件不能用会随主题反战的 `--notion-page`：
 * 深色主题下该变量是 #191919，与 #111111 遮罩的对比只有 1.07，按钮会融进背景。
 * 因此这里固定用浅色控件（底 #FFFFFF / 字 #2F3437），与遮罩对比 18.88，两主题一致。
 */
const toolbarButtonClassName =
  'inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--notion-page)] text-[var(--notion-text)] shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition hover:bg-[var(--notion-surface-hover)]'

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
      className={LIGHTBOX_SCRIM}
      data-testid={workbenchSelectors.attachmentPreviewModal}
      onWheel={(event) => {
        event.preventDefault()
        updateScale(scale + (event.deltaY > 0 ? -0.1 : 0.1))
      }}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-default"
        aria-label={t(($) => $.workbench.closeImagePreviewBackground)}
        onClick={onClose}
      />

      {/*
        工具栏避开原生标题栏：Windows 的窗口按钮由系统画在右上角并被覆盖在页面之上，
        顶到 top-5 会被它们盖住，导致看不清也点不到；`--window-titlebar-safe-top` 在
        Windows 上等于标题栏高度，其他平台为 0，因此这里不需要平台分支。
      */}
      <div className="absolute right-5 top-[calc(var(--window-titlebar-safe-top)+1.25rem)] z-[2] flex items-center gap-3">
        <button
          type="button"
          className={toolbarButtonClassName}
          aria-label={t(($) => $.workbench.downloadImage)}
          title={t(($) => $.common.download)}
          onClick={() => {
            const link = document.createElement('a')
            link.href = image.src
            link.download = image.name
            link.rel = 'noopener'
            document.body.appendChild(link)
            link.click()
            link.remove()
          }}
        >
          <HiArrowDownTray className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={toolbarButtonClassName}
          aria-label={t(($) => $.workbench.closeImagePreview)}
          title={t(($) => $.common.close)}
          onClick={onClose}
        >
          <HiXMark className="h-6 w-6" />
        </button>
      </div>

      <div className="relative z-[1] flex h-full w-full items-center justify-center px-6 pb-24 pt-[calc(var(--window-titlebar-safe-top)+5rem)]">
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

      <div className="absolute bottom-6 left-1/2 z-[2] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--notion-page)] px-2 py-1.5 text-[var(--notion-text)] shadow-[0_10px_28px_rgba(0,0,0,0.32)]">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[var(--notion-surface-hover)]"
          aria-label={t(($) => $.common.zoomOut)}
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
          className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[var(--notion-surface-hover)]"
          aria-label={t(($) => $.common.zoomIn)}
          onClick={() => updateScale(scale + 0.1)}
        >
          <HiPlus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default ImageLightbox
