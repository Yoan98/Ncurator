import React, { useCallback, useEffect, useRef, useState } from 'react'
import { HiArrowPath } from 'react-icons/hi2'
import { t } from '../../i18n'
import type { LlmEffort } from '../../../../shared/llmPresets'
import {
  EFFORT_THUMB_RADIUS,
  EFFORT_THUMB_SIZE,
  EFFORT_TRACK_HEIGHT,
  effortFillWidth,
  effortIndexFromOffset,
  effortStopPositions
} from '../../../../shared/effortSliderGeometry'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchEffortCardProps = {
  effort: LlmEffort
  value: string
  modelLabel: string
  onChange: (value: string) => void
  onPickModel: () => void
  disabled?: boolean
}

/** 点位、填充、拖拽换算共用 shared/effortSliderGeometry，因此圆点永远压在小点上。 */
const THUMB_SIZE = EFFORT_THUMB_SIZE
const THUMB_RADIUS = EFFORT_THUMB_RADIUS
const stopPositions = effortStopPositions

/**
 * 思考强度卡片。档位与顺序完全来自目录配置，目录给了几档就画几个点。
 *
 * 交互：按住圆点拖动（实时吸附最近档位）、点轨道跳档、点小点切档、
 * ← → 逐档、Home / End 到首尾、右上角复位。
 */
export const WorkbenchEffortCard: React.FC<WorkbenchEffortCardProps> = ({
  effort,
  value,
  modelLabel,
  onChange,
  onPickModel,
  disabled
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)

  const index = Math.max(
    0,
    effort.options.findIndex((option) => option.value === value)
  )
  const count = effort.options.length
  const current = effort.options[index] || effort.options[0]
  const selectedIsDefault = current.value === effort.default
  const positions = stopPositions(width, count)
  const activeX = positions[index] ?? 0

  // 轨道宽度随面板宽度变化，用 ResizeObserver 保持点位随动。
  useEffect(() => {
    const node = trackRef.current
    if (!node) return
    const sync = (): void => setWidth(node.clientWidth)
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const selectIndex = useCallback(
    (nextIndex: number): void => {
      const option = effort.options[nextIndex]
      if (!option || disabled) return
      if (option.value !== value) onChange(option.value)
    },
    [disabled, effort.options, onChange, value]
  )

  /** 把指针位置换算成最近的档位。 */
  const indexFromClientX = useCallback(
    (clientX: number): number => {
      const node = trackRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return effortIndexFromOffset(clientX - rect.left, rect.width, count)
    },
    [count]
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0) return
    draggingRef.current = true
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    selectIndex(indexFromClientX(event.clientX))
    event.preventDefault()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    selectIndex(indexFromClientX(event.clientX))
    event.preventDefault()
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectIndex(Math.min(index + 1, count - 1))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      selectIndex(Math.max(index - 1, 0))
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectIndex(count - 1)
    }
  }

  return (
    <div
      data-testid={workbenchSelectors.effortCard}
      className="px-[18px] pb-5 pt-3.5"
    >
      <div className="relative">
        <div
          data-testid={workbenchSelectors.effortValue}
          className="truncate text-center text-[16px] font-semibold leading-[22px] text-[#0B6BCB]"
        >
          {current.label}
        </div>
        <button
          type="button"
          disabled={disabled}
          data-testid={workbenchSelectors.effortModelName}
          onClick={onPickModel}
          className="mx-auto mt-0.5 flex max-w-full items-center justify-center gap-[3px] rounded-[5px] px-1.5 py-px text-[13px] text-[#787774] hover:bg-[#EFEFEE] hover:text-[#37352F] disabled:hover:bg-transparent disabled:hover:text-[#787774]"
        >
          <span className="min-w-0 truncate">{modelLabel}</span>
          <span aria-hidden="true" className="shrink-0 text-[10px] text-[#91918E]">
            ›
          </span>
        </button>
        <button
          type="button"
          aria-label={t(($) => $.workbench.effortReset)}
          data-testid={workbenchSelectors.effortReset}
          disabled={disabled || selectedIsDefault}
          className="absolute -top-0.5 right-[-6px] inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[#B9B8B4] transition hover:bg-[#EFEFEE] hover:text-[#787774] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#B9B8B4]"
          onClick={() => onChange(effort.default)}
        >
          <HiArrowPath className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={trackRef}
        role="radiogroup"
        aria-label={t(($) => $.workbench.effortSlider)}
        data-testid={workbenchSelectors.effortSlider}
        tabIndex={disabled ? -1 : 0}
        className="relative mt-[15px] h-7 cursor-pointer select-none outline-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={handleKeyDown}
      >
        {/* 轨道：24px 粗胶囊。
            注意不能写 h-6 —— 本项目根字号是 14px，h-6 = 1.5rem = 21px，
            会让轨道做细、跟 27px 的滑块比例失调。 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[#F4F4F2]"
          style={{ height: EFFORT_TRACK_HEIGHT }}
        />
        {/* 填充：从轨道左端到滑块左缘 */}
        <div
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-[#0B6BCB] transition-[width] duration-150"
          style={{ height: EFFORT_TRACK_HEIGHT, width: effortFillWidth(activeX) }}
        />
        {/* 档位小点：4px，已过档位用浅蓝 */}
        {effort.options.map((option, optionIndex) => {
          const passed = optionIndex < index
          const active = optionIndex === index
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              aria-hidden={active}
              tabIndex={-1}
              disabled={disabled}
              data-testid={`${workbenchSelectors.effortStopPrefix}-${option.value}`}
              onClick={(event) => {
                event.stopPropagation()
                selectIndex(optionIndex)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: positions[optionIndex] ?? 0,
                background: active ? 'transparent' : passed ? '#7EAAFA' : '#BDBBBD',
                cursor: 'pointer'
              }}
            />
          )
        })}
        {/* 滑块圆点。参考图实测：白圆 + 1px 灰色硬边（#E4E4E5），无模糊阴影。
            用 border 而不是 box-shadow：box-shadow 画在盒子外侧，会在填充与滑块之间
            旦出 1px 缝；border 画在盒内，圆点外径保持 27px 不变。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 rounded-full bg-white transition-[left] duration-150"
          style={{
            left: activeX,
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            marginLeft: -THUMB_RADIUS,
            marginTop: -THUMB_RADIUS,
            border: `1px solid ${dragging ? '#D8D8D9' : '#E4E4E5'}`
          }}
        />
      </div>
    </div>
  )
}

export default WorkbenchEffortCard
