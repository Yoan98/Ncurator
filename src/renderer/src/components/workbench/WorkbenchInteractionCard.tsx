import React from 'react'
import { Input, Spin } from 'antd'
import {
  HiArrowRight,
  HiArrowUp,
  HiCheck,
  HiChevronLeft,
  HiChevronRight,
  HiOutlinePencil,
  HiOutlineQuestionMarkCircle,
  HiOutlineShieldCheck,
  HiStop
} from 'react-icons/hi2'

const iconButtonClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#787774] transition-colors hover:bg-[#F4F4F2] focus-visible:outline-2 focus-visible:outline-[#0B6BCB] disabled:cursor-not-allowed disabled:opacity-35'

type CardProps = {
  source?: React.ReactNode
  title: string
  itemLabel: '问题' | '操作确认'
  currentIndex: number
  total: number
  busy: boolean
  cancelling: boolean
  onPrevious: () => void
  onNext: () => void
  onCancel: () => void
  cardTestId: string
  previousTestId: string
  nextTestId: string
  cancelTestId: string
  onPrimaryAction: () => void
  children?: React.ReactNode
  footer: React.ReactNode
}

export const WorkbenchInteractionCard: React.FC<CardProps> = (props) => (
  <section
    className="nc-timeline-layout-anchor flex max-h-[calc(100vh-120px)] min-w-0 flex-col overflow-hidden rounded-[12px] border border-[#E0DFDC] bg-white text-[#37352F] shadow-[0_8px_24px_rgba(15,15,15,0.065)]"
    data-testid={props.cardTestId}
    onKeyDownCapture={(event) => {
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.altKey ||
        event.nativeEvent.isComposing ||
        event.keyCode === 229
      )
        return
      const button = event.target instanceof HTMLElement ? event.target.closest('button') : null
      if (button?.closest('header')) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat && !props.busy && !props.cancelling) props.onPrimaryAction()
    }}
  >
    <header className="flex shrink-0 items-center justify-between gap-2 px-[18px] pt-3">
      <div className="flex min-w-0 items-center gap-[7px] text-xs text-[#787774]">
        {props.itemLabel === '问题' ? (
          <HiOutlineQuestionMarkCircle className="h-[15px] w-[15px] shrink-0" />
        ) : (
          <HiOutlineShieldCheck className="h-[15px] w-[15px] shrink-0" />
        )}
        <span className="shrink-0">{props.itemLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {props.total > 1 && (
          <>
            <span
              className="mr-[7px] whitespace-nowrap text-xs text-[#91918E] tabular-nums"
              data-testid={`${props.cardTestId}-position`}
            >
              {props.currentIndex + 1} / {props.total}
            </span>
            <button
              type="button"
              className={iconButtonClass}
              aria-label={`上一个${props.itemLabel}`}
              disabled={props.currentIndex === 0 || props.busy || props.cancelling}
              onClick={props.onPrevious}
              data-testid={props.previousTestId}
            >
              <HiChevronLeft className="h-[15px] w-[15px]" />
            </button>
            <button
              type="button"
              className={iconButtonClass}
              aria-label={`下一个${props.itemLabel}`}
              disabled={props.currentIndex >= props.total - 1 || props.busy || props.cancelling}
              onClick={props.onNext}
              data-testid={props.nextTestId}
            >
              <HiChevronRight className="h-[15px] w-[15px]" />
            </button>
          </>
        )}
        <button
          type="button"
          className={`${iconButtonClass} ml-1`}
          aria-label={props.cancelling ? '正在停止本次运行' : '停止本次运行'}
          title="停止本次运行"
          disabled={props.cancelling}
          onClick={props.onCancel}
          data-testid={props.cancelTestId}
        >
          {props.cancelling ? <Spin size="small" /> : <HiStop className="h-3 w-3" />}
        </button>
      </div>
    </header>
    <div className="min-h-0 overflow-y-auto">
      {props.source && (
        <div className="mx-5 mt-2 flex min-w-0 items-center gap-2 break-words text-xs text-[#787774]">
          {props.source}
        </div>
      )}
      <div
        className="mx-5 mt-3 mb-[14px] break-words text-[15px] leading-[1.65] font-medium [overflow-wrap:anywhere]"
        data-testid={`${props.cardTestId}-title`}
      >
        {props.title}
      </div>
      {props.children}
    </div>
    {props.footer}
  </section>
)

type ChoiceProps = {
  selected: boolean
  disabled: boolean
  index: number
  label: string
  description?: string
  recommended?: boolean
  multiple?: boolean
  onClick: () => void
  testId: string
}

export const WorkbenchInteractionChoice: React.FC<ChoiceProps> = (props) => (
  <button
    type="button"
    aria-pressed={props.selected}
    disabled={props.disabled}
    onClick={props.onClick}
    data-testid={props.testId}
    className={`flex min-h-[46px] w-full items-center gap-3 rounded-[8px] p-2.5 text-left text-sm transition-colors outline-none focus-visible:bg-[#EFEFEE] disabled:cursor-not-allowed disabled:opacity-45 ${props.selected ? 'bg-[#F4F4F2]' : 'hover:bg-[#F8F8F7]'}`}
  >
    <span
      aria-hidden="true"
      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border text-xs ${props.selected ? 'border-[#37352F] bg-[#37352F] text-white' : 'border-[#E0DFDC] bg-white text-[#787774]'}`}
    >
      {props.multiple ? props.selected && <HiCheck className="h-3.5 w-3.5" /> : props.index + 1}
    </span>
    <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
      {props.label}
      {props.recommended && (
        <span className="ml-2 whitespace-nowrap text-[11px] text-[#787774]">推荐</span>
      )}
      {props.description && (
        <span className="block text-xs text-[#787774]">{props.description}</span>
      )}
    </span>
  </button>
)

type FooterProps = {
  value: string
  placeholder: string
  submitting: boolean
  inputDisabled: boolean
  disabled: boolean
  label: string
  next: boolean
  expanded?: boolean
  hint?: string
  error?: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputTestId: string
  submitTestId: string
}

export const WorkbenchInteractionFooter: React.FC<FooterProps> = (props) => (
  <div
    className={`shrink-0 px-[18px] pb-4 ${props.expanded ? '' : 'mt-[15px] border-t border-[#EEEEEC] pt-[14px]'}`}
  >
    <div className={`flex items-start gap-2 ${props.expanded ? '' : 'px-[11px]'}`}>
      {!props.expanded && (
        <HiOutlinePencil
          aria-hidden="true"
          className="mt-[10px] h-[15px] w-[15px] shrink-0 text-[#91918E]"
        />
      )}
      <Input.TextArea
        autoSize={{ minRows: props.expanded ? 3 : 1, maxRows: 6 }}
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        value={props.value}
        disabled={props.inputDisabled || props.submitting}
        onChange={(event) => props.onChange(event.target.value)}
        data-testid={props.inputTestId}
        className={`min-w-0 flex-1 ${props.expanded ? '' : 'nc-workbench-interaction-inline-input'}`}
      />
    </div>
    {props.error && (
      <div role="alert" className="mt-2 break-words text-xs text-[#B3261E]">
        {props.error}
      </div>
    )}
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5">
      <span aria-live="polite" className="min-w-0 break-words text-xs text-[#91918E]">
        {props.hint}
      </span>
      <button
        type="button"
        onClick={props.onSubmit}
        disabled={props.disabled || props.submitting || props.inputDisabled}
        data-testid={props.submitTestId}
        className="ml-auto inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-[#37352F] px-3 py-[5px] text-[13px] leading-[22px] font-medium text-white focus-visible:outline-2 focus-visible:outline-[#0B6BCB] disabled:cursor-not-allowed disabled:bg-[#F4F4F2] disabled:text-[#91918E]"
      >
        {props.label}
        {props.submitting ? (
          <Spin size="small" />
        ) : props.next ? (
          <HiArrowRight className="h-3.5 w-3.5" />
        ) : (
          <HiArrowUp className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  </div>
)
