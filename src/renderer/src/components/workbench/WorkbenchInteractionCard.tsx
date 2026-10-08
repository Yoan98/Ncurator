import React from 'react'
import { Button, Spin } from 'antd'
import { HiArrowUp, HiChevronLeft, HiChevronRight, HiStop } from 'react-icons/hi2'

type WorkbenchInteractionCardProps = {
  source?: React.ReactNode
  title: string
  itemLabel: string
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
  children: React.ReactNode
  footer: React.ReactNode
}

export const WorkbenchInteractionCard: React.FC<WorkbenchInteractionCardProps> = ({
  source,
  title,
  itemLabel,
  currentIndex,
  total,
  busy,
  cancelling,
  onPrevious,
  onNext,
  onCancel,
  cardTestId,
  previousTestId,
  nextTestId,
  cancelTestId,
  children,
  footer
}) => (
  <div
    className="nc-timeline-layout-anchor min-w-0 overflow-hidden rounded-[12px] border border-[#E0DFDC] bg-white shadow-[0_8px_24px_rgba(15,15,15,0.08)]"
    data-testid={cardTestId}
  >
    {source ? (
      <div className="flex items-center gap-2 px-5 pt-4 text-[13px] text-[#787774]">{source}</div>
    ) : null}
    <div className="flex items-start justify-between gap-3 px-5 pt-4">
      <div
        className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-6 text-[#37352F]"
        data-testid={`${cardTestId}-title`}
      >
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <div
          className="mr-1 whitespace-nowrap text-xs text-[#9B9A97]"
          data-testid={`${cardTestId}-position`}
        >
          {itemLabel} {currentIndex + 1} / {total}
        </div>
        <Button
          type="text"
          size="small"
          icon={<HiChevronLeft className="h-4 w-4" />}
          aria-label={`上一个${itemLabel}`}
          disabled={currentIndex <= 0 || busy || cancelling}
          onClick={onPrevious}
          data-testid={previousTestId}
        />
        <Button
          type="text"
          size="small"
          icon={<HiChevronRight className="h-4 w-4" />}
          aria-label={`下一个${itemLabel}`}
          disabled={currentIndex >= total - 1 || busy || cancelling}
          onClick={onNext}
          data-testid={nextTestId}
        />
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className={`ml-1 inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-white transition ${
            cancelling ? 'bg-[#E0DFDC]' : 'bg-[#B3261E] hover:bg-[#8F3028]'
          }`}
          data-testid={cancelTestId}
          aria-label={cancelling ? '正在停止本次运行' : '停止本次运行'}
        >
          {cancelling ? <Spin size="small" /> : <HiStop className="h-4 w-4" />}
        </button>
      </div>
    </div>
    {children}
    {footer}
  </div>
)

type WorkbenchInteractionFooterProps = {
  value: string
  placeholder: string
  submitting: boolean
  disabled: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  inputTestId: string
  submitTestId: string
  inputRef?: React.Ref<HTMLInputElement>
  inputDisabled?: boolean
}

export const WorkbenchInteractionFooter: React.FC<WorkbenchInteractionFooterProps> = ({
  value,
  placeholder,
  submitting,
  disabled,
  onChange,
  onSubmit,
  inputTestId,
  submitTestId,
  inputRef,
  inputDisabled = false
}) => (
  <div className="mt-3 flex items-center gap-2 border-t border-[#EEEEEC] px-4 py-4">
    <input
      ref={inputRef}
      className="min-w-0 flex-1 rounded-[6px] border border-[#EEEEEC] bg-white px-3 py-2 text-sm text-[#37352F] outline-none placeholder:text-[#9B9A97] focus:border-[#37352F] focus:ring-2 focus:ring-[#EFEFED]"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={submitting || inputDisabled}
      data-testid={inputTestId}
    />
    <Button
      type="primary"
      className="!flex !h-9 !items-center !gap-1 !rounded-full !border-[#37352F] !bg-[#37352F] !text-white hover:!bg-[#2F3437] disabled:!border-[#EEEEEC] disabled:!bg-[#F4F4F2] disabled:!text-[#9B9A97]"
      icon={<HiArrowUp className="h-4 w-4" />}
      onClick={onSubmit}
      loading={submitting}
      disabled={disabled}
      data-testid={submitTestId}
    >
      提交
    </Button>
  </div>
)
