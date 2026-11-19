import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HiArrowPath, HiCheck, HiXMark } from 'react-icons/hi2'
import { t } from '../../i18n'
import type { LlmEffort } from '../../../../shared/llmPresets'
import {
  EFFORT_THUMB_RADIUS,
  EFFORT_THUMB_SIZE,
  EFFORT_TRACK_HEIGHT,
  EFFORT_TRACK_RADIUS,
  effortClampToTrack,
  effortFillWidth,
  effortIndexFromOffset,
  effortPaletteFromAvatarColor,
  effortStopPositions
} from '../../../../shared/effortSliderGeometry'
import PartnerAvatar, { PARTNER_AVATAR_COLOR_HEX } from './PartnerAvatar'
import type { PartnerAvatarColor, PartnerAvatarShape } from '../../../../shared/types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchEffortCardProps = {
  effort: LlmEffort
  value: string
  modelLabel: string
  onChange: (value: string) => void
  onPickModel: () => void
  /** 当前伙伴形象；没有时退回普通白圆滑块。 */
  avatar?: { shape: PartnerAvatarShape; color: PartnerAvatarColor } | null
  /** 右上角刷新：拉取模型列表接口（与原先列表右上角是同一个动作）。 */
  onRefresh?: () => void
  refreshStatus?: 'idle' | 'loading' | 'success' | 'error'
  disabled?: boolean
}

/** 点位、填充、拖拽换算共用 shared/effortSliderGeometry，因此圆点永远压在小点上。 */
const THUMB_SIZE = EFFORT_THUMB_SIZE
const THUMB_RADIUS = EFFORT_THUMB_RADIUS
const stopPositions = effortStopPositions
/** 吸附过渡时长，必须与下面 transition 里的 160ms 一致。 */
const SNAP_MS = 160

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
  avatar,
  onRefresh,
  refreshStatus = 'idle',
  disabled
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  /** 松手吸附的收尾定时器；卸载时取消，避免对已卸载组件 setState。 */
  const snapTimerRef = useRef<number | null>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  /**
   * 是否处于「被抓痒」表情。
   *
   * 比 dragging 晚一点收：松手后形象还要吸附滑动一段，如果立刻恢复静止表情，
   * 翻滚动画会被生生切断，看起来像一顿。等吸附跑完再收，动作才连贯。
   */
  const [tickled, setTickled] = useState(false)
  /**
   * 拖拽中滑块的实时横坐标。
   *
   * 拖拽时滑块必须严格跟手（跟随指针），不能一格一格跳；松手才吸附到最近档位。
   * null 表示未拖拽，此时位置由所选档位决定。
   */
  const [dragX, setDragX] = useState<number | null>(null)

  const index = Math.max(
    0,
    effort.options.findIndex((option) => option.value === value)
  )
  const count = effort.options.length
  const current = effort.options[index] || effort.options[0]
  const positions = stopPositions(width, count)
  /** 滑块当前横坐标：拖拽时跟手，否则对齐所选档位。 */
  const activeX = dragX ?? positions[index] ?? 0

  /**
   * 拖拽中指针所对应的档位，用于「文字实时跟着变」。
   *
   * 只影响显示：真正的 onChange 仍然只在松手时触发，
   * 所以请求所用强度和持久化值不会在拖动过程中被反复改写。
   */
  const previewIndex = dragging && dragX !== null
    ? effortIndexFromOffset(dragX, width || 1, count)
    : index
  /** 拖动时用预览档位，否则用真实选中档位。 */
  const displayOption = effort.options[previewIndex] || current

  /**
   * 填充宽度。
   *
   * 末档把填充铺满整条轨道：形象中心停在「轨道条右端 - 轨道半径」处，
   * 只画到中心会让右侧剩半圆形的一截浅色轨道，看着就是一条缝。
   *
   * 判定必须用「形象是否真的落在末档位置上」，不能用最近档位下标：
   * 拖拽接近末档时下标已经四舍五入成末档，但形象还在半路，
   * 那会让填充一下子跳满整条轨道、超出形象右缘。
   */
  const atLastStop = count > 1 && activeX >= (positions[count - 1] ?? Infinity) - 0.5
  const fillWidth = effortFillWidth(activeX, width, atLastStop)

  /**
   * 配色跟随伙伴主色：填充与轨道都由形象色派生。
   * 没有伙伴形象时退回默认蓝，保证滑块区域始终有明确配色。
   */
  const palette = avatar
    ? effortPaletteFromAvatarColor(PARTNER_AVATAR_COLOR_HEX[avatar.color])
    : { fill: '#3983F7', track: '#E8E7E7' }

  /**
   * 轨道宽度必须始终是最新值：点位、填充、滑块位置全部由它推导。
   * 之前只在 effect 里量一次，面板宽度变化或首次布局未完成时会拿到旧值，
   * 表现就是「滑块停在偏左的位置、和轨道末端对不齐」。
   *
   * 这里用 useLayoutEffect 在绘制前同步，再叠 ResizeObserver 与 resize 兜底。
   */
  useEffect(
    () => () => {
      if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current)
    },
    []
  )

  useLayoutEffect(() => {
    const node = trackRef.current
    if (!node) return
    const sync = (): void => {
      const next = node.clientWidth
      if (next > 0) setWidth((current) => (current === next ? current : next))
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync)
      return () => window.removeEventListener('resize', sync)
    }
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  const selectIndex = useCallback(
    (nextIndex: number): void => {
      const option = effort.options[nextIndex]
      if (!option || disabled) return
      if (option.value !== value) onChange(option.value)
    },
    [disabled, effort.options, onChange, value]
  )

  /** 把指针的视口坐标换算成轨道内坐标。 */
  const offsetFromClientX = useCallback((clientX: number): { x: number; width: number } => {
    const node = trackRef.current
    if (!node) return { x: 0, width: 0 }
    const rect = node.getBoundingClientRect()
    return { x: clientX - rect.left, width: rect.width }
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0) return
    draggingRef.current = true
    setDragging(true)
    setTickled(true)
    // 取消上一次吸附的收尾，避免刚抓住就被上一次的定时器打断表情。
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current)
      snapTimerRef.current = null
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    // 点轨道任意位置：滑块先贴到指针，之后严格跟手；松手时才吸附。
    const { x, width: trackWidth } = offsetFromClientX(event.clientX)
    setDragX(effortClampToTrack(x, trackWidth, count))
    event.preventDefault()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    const { x, width: trackWidth } = offsetFromClientX(event.clientX)
    // 只更新位置，不立刻改档位：跟手才丝滑，档位在松手时按最近点吸附。
    setDragX(effortClampToTrack(x, trackWidth, count))
    event.preventDefault()
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const released = dragX
    if (released === null) {
      setDragging(false)
      return
    }

    /*
     * 松手吸附：把 dragX 直接改成吸附点，让过渡从松手位置出发。
     *
     * 这里有个容易踩的坑：如果松手就把 dragX 清成 null，activeX 会立刻回落到
     * positions[index]。但此刻 onChange 还没把新的 value 传回来，index 仍是旧档位，
     * 于是滑块会「先跳回旧档位、再跳到新档位」——两次跳动，看起来就是卡一下。
     *
     * 改法：dragX 停在吸附点上，等过渡跑完（SNAP_MS）再清空。
     * 那时父组件的 value 已经更新，positions[index] 就等于吸附点，清空不会有任何视觉变化。
     */
    const nearest = effortIndexFromOffset(released, width || 1, count)
    const snapX = effortClampToTrack(positions[nearest] ?? released, width || 1, count)

    setDragging(false)
    // 先提交选择，让父组件的 value 尽快跟上，缩短「index 还没更新」的窗口。
    selectIndex(nearest)
    // dragX 钉在吸附点上：过渡从松手位置出发，不会先跳回旧档位。
    setDragX(snapX)

    /*
     * 统一走定时器收尾，包括「松手点正好落在档位上」的情况。
     *
     * 那个分支不能直接清空 dragX：此刻 index 可能还是旧值，
     * 清空会让 activeX 回落到旧档位，滑块先弹回去再跳过来。
     * 也不能提前 return——否则 tickled 永远不会复位，伙伴会卡在笑脸。
     */
    if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current)
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null
      setDragX(null)
      // 吸附结束再收表情，避免被抓痒的翻滚动画被硬切。
      setTickled(false)
    }, SNAP_MS)
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
      // 左右内边距比上下小：轨道条两端各内缩 EFFORT_TRACK_RADIUS 才能让形象正对圆头，
      // 内边距再留 18px 的话轨道两侧会显得空一截。14px 让形象右缘距卡片边留 2px 余量。
      className="px-[14px] pb-5 pt-3.5"
    >
      <div className="relative">
        <div
          data-testid={workbenchSelectors.effortValue}
          className="truncate text-center text-[16px] font-semibold leading-[22px]"
          style={{ color: palette.fill }}
        >
          {displayOption.label}
        </div>
        <button
          type="button"
          disabled={disabled}
          data-testid={workbenchSelectors.effortModelName}
          onClick={onPickModel}
          className="group mx-auto mt-0.5 flex max-w-full items-center justify-center gap-[3px] px-1 py-px text-[13px] text-[var(--notion-text-soft)] transition-colors hover:text-[var(--notion-text)] disabled:hover:text-[var(--notion-text-soft)]"
        >
          <span className="min-w-0 truncate">{modelLabel}</span>
          <span
            aria-hidden="true"
            // 原 10px 太小，视觉上几乎看不见；14px 与模型名基线更协调。
            className="shrink-0 text-[14px] leading-none text-[var(--notion-text-faint)] transition-transform group-hover:translate-x-0.5"
          >
            ›
          </span>
        </button>
        <button
          type="button"
          aria-label={t(($) => $.workbench.refreshModelCatalogs)}
          data-testid={workbenchSelectors.modelSelectCatalogRefresh}
          disabled={disabled || refreshStatus === 'loading'}
          className="absolute -top-0.5 right-[-6px] inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--notion-text-faint)] transition hover:bg-[var(--notion-surface-hover)] hover:text-[var(--notion-text-soft)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--notion-text-faint)]"
          onClick={onRefresh}
        >
          {refreshStatus === 'success' ? (
            <HiCheck className="h-3.5 w-3.5 text-[var(--notion-green)]" />
          ) : refreshStatus === 'error' ? (
            <HiXMark className="h-3.5 w-3.5 text-[var(--notion-red)]" />
          ) : (
            <HiArrowPath
              className={`h-3.5 w-3.5${refreshStatus === 'loading' ? ' animate-spin' : ''}`}
            />
          )}
        </button>
      </div>

      <div
        ref={trackRef}
        role="radiogroup"
        aria-label={t(($) => $.workbench.effortSlider)}
        data-testid={workbenchSelectors.effortSlider}
        tabIndex={disabled ? -1 : 0}
        className="relative mt-[15px] cursor-pointer select-none outline-none"
        // 轨道容器高度必须容得下 48px 形象：菜单容器是 overflow-hidden，
        // 容器比形象矮时形象上下会被裁掉一截。用像素常量，别用 h-* 类。
        style={{ touchAction: 'none', height: THUMB_SIZE }}
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
        {/* 轨道条两端内缩一个轨道半径：它的圆头圆心才落在形象中心该在的位置，
            形象于是「站在轨道端头的中间」，左右两端对称。 */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            height: EFFORT_TRACK_HEIGHT,
            left: EFFORT_TRACK_RADIUS,
            right: EFFORT_TRACK_RADIUS,
            background: palette.track
          }}
        />
        {/* 填充：从轨道左端画到滑块中心，末端由形象盖住 */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            height: EFFORT_TRACK_HEIGHT,
            left: EFFORT_TRACK_RADIUS,
            background: palette.fill,
            width: fillWidth,
            transition: dragging ? 'none' : 'width 160ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
        />
        {/* 档位小点：4px，已过档位用浅蓝 */}
        {effort.options.map((option, optionIndex) => {
          const active = optionIndex === index
          /**
           * 是否已被填充盖过。
           *
           * 用填充右缘与点位比较，而不是比较档位下标：拖拽过程中下标不变，
           * 按下标上色会让点「该亮不亮」。这样拖动时点会跟着填充逐个变白。
           */
          const passed = (positions[optionIndex] ?? 0) <= activeX + 0.5
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
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
                // 每个点始终绘制——被选中的那个由形象自然盖住，不需要额外隐藏；
                // 之前把选中点设成透明，拖动时下标还没更新，那个点就凭空消失了。
                // 已过的点用半透明白：填充色随伙伴变化，写死浅蓝只在蓝色下好看。
                background: passed ? 'rgba(255, 255, 255, 0.62)' : '#B4B4B5',
                cursor: 'pointer'
              }}
            />
          )
        })}
        {/* 滑块：直接就是伙伴形象本身，不垫白色圆底。
            形象压在轨道上，靠一层很轻的投影与蓝色填充区分开；
            抓住时换成 tickled 表情并触发「被挠到翻」的动作。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 grid place-items-center"
          style={{
            left: activeX,
            // 拖拽时严格跟手（无动画）；松手吸附时给一段短缓动，才有"吸过去"的手感。
            transition: dragging ? 'none' : 'left 160ms cubic-bezier(0.22, 1, 0.36, 1)',
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            marginLeft: -THUMB_RADIUS,
            marginTop: -THUMB_RADIUS
          }}
        >
          {avatar ? (
            <PartnerAvatar
              shape={avatar.shape}
              color={avatar.color}
              size={THUMB_SIZE}
              mood={tickled ? 'tickled' : 'idle'}
              className="nc-effort-avatar"
            />
          ) : (
            // 没有伙伴形象时退回一个中性圆点，避免滑块位置空着。
            <span
              className="block rounded-full bg-[var(--notion-page)]"
              style={{
                width: THUMB_SIZE,
                height: THUMB_SIZE,
                boxShadow: `0 0 0 1px ${dragging ? '#D8D8D9' : '#E4E4E5'}`
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default WorkbenchEffortCard
