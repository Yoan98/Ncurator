import React, { useRef } from 'react'
import { HiArrowPath, HiBolt } from 'react-icons/hi2'
import { t } from '../../i18n'
import type { LlmEffort } from '../../../../shared/llmPresets'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchEffortCardProps = {
  effort: LlmEffort
  value: string
  modelLabel: string
  onChange: (value: string) => void
  onPickModel: () => void
  disabled?: boolean
}

/**
 * 思考强度卡片：嵌在模型面板顶部。档位与顺序完全来自目录配置，
 * 目录给了几档就画几个点，不在客户端补齐或改名。
 */
export const WorkbenchEffortCard: React.FC<WorkbenchEffortCardProps> = ({
  effort,
  value,
  modelLabel,
  onChange,
  onPickModel,
  disabled
}) => {
  const stopsRef = useRef<HTMLDivElement>(null)
  const index = Math.max(
    0,
    effort.options.findIndex((option) => option.value === value)
  )
  const count = effort.options.length
  const current = effort.options[index] || effort.options[0]
  const selectedIsDefault = current.value === effort.default
  const ratio = count > 1 ? index / (count - 1) : 0

  const move = (nextIndex: number): void => {
    const option = effort.options[nextIndex]
    if (!option) return
    onChange(option.value)
    window.requestAnimationFrame(() => {
      const stops = stopsRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      stops?.[nextIndex]?.focus()
    })
  }

  return (
    <div
      data-testid={workbenchSelectors.effortCard}
      className="mx-1.5 mb-1.5 rounded-[12px] border border-[#E5E4E0] bg-white px-2.5 pb-2.5 pt-2"
    >
      <div className="flex items-center justify-between gap-2">
        <HiBolt aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#9B9A97]" />
        <span
          data-testid={workbenchSelectors.effortValue}
          className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold text-[#0B6BCB]"
        >
          {current.label}
        </span>
        <button
          type="button"
          aria-label={t(($) => $.workbench.effortReset)}
          data-testid={workbenchSelectors.effortReset}
          disabled={disabled || selectedIsDefault}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#9B9A97] transition hover:text-[#37352F] disabled:cursor-default disabled:opacity-30 disabled:hover:text-[#9B9A97]"
          onClick={() => onChange(effort.default)}
        >
          <HiArrowPath className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        data-testid={workbenchSelectors.effortModelName}
        onClick={onPickModel}
        className="mx-auto mt-0.5 flex max-w-full items-center justify-center gap-0.5 rounded-[6px] px-1 text-[12px] text-[#787774] hover:text-[#37352F] disabled:hover:text-[#787774]"
      >
        <span className="min-w-0 truncate">{modelLabel}</span>
        <span aria-hidden="true" className="shrink-0 text-[10px]">
          ›
        </span>
      </button>

      <div
        ref={stopsRef}
        role="radiogroup"
        aria-label={t(($) => $.workbench.effortSlider)}
        data-testid={workbenchSelectors.effortSlider}
        className="relative mx-0.5 mt-2 h-6"
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            move(Math.min(index + 1, count - 1))
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            move(Math.max(index - 1, 0))
          } else if (event.key === 'Home') {
            event.preventDefault()
            move(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            move(count - 1)
          }
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#EDEDEB]" />
        <div
          className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#2E7CF6] transition-[width] duration-150"
          style={{ left: 0, width: `${ratio * 100}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-between">
          {effort.options.map((option, optionIndex) => {
            const active = optionIndex === index
            const passed = optionIndex <= index
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={option.label}
                tabIndex={active ? 0 : -1}
                disabled={disabled}
                data-testid={`${workbenchSelectors.effortStopPrefix}-${option.value}`}
                onClick={() => move(optionIndex)}
                className={
                  active
                    ? 'h-5 w-5 shrink-0 rounded-full border-2 border-[#2E7CF6] bg-white shadow-[0_1px_2px_rgba(15,15,15,0.12)]'
                    : `h-2 w-2 shrink-0 rounded-full ${passed ? 'bg-white/80' : 'bg-[#C9C7C1]'}`
                }
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default WorkbenchEffortCard
