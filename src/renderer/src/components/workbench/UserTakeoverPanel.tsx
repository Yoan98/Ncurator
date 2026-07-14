import React from 'react'
import { Button } from 'antd'
import { HiCheck, HiHandRaised, HiXMark } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'

type UserTakeoverPanelProps = {
  message: string
  confirming: boolean
  cancelling: boolean
  onConfirm: () => void
  onCancel: () => void
}

const UserTakeoverPanel: React.FC<UserTakeoverPanelProps> = ({
  message,
  confirming,
  cancelling,
  onConfirm,
  onCancel
}) => {
  const disabled = confirming || cancelling

  return (
    <div
      className="min-w-0 overflow-hidden rounded-[12px] border border-[#E0DFDC] bg-white shadow-[0_8px_24px_rgba(15,15,15,0.08)]"
      data-testid={workbenchSelectors.userTakeoverPanel}
    >
      <div className="flex items-start gap-3 px-5 pt-5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F4F4F2] text-[#37352F]">
          <HiHandRaised className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[#37352F]">需要你接手操作</div>
          <div className="mt-1 text-[13px] leading-6 text-[#787774]">
            请在右侧浏览器完成操作，完成后继续任务。
          </div>
        </div>
      </div>

      <div
        className="mx-5 mt-4 rounded-[8px] border border-[#EEEEEC] bg-[#F7F7F5] px-4 py-3 text-[14px] leading-6 text-[#37352F]"
        data-testid={workbenchSelectors.userTakeoverMessage}
      >
        {message}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#EEEEEC] px-4 py-4">
        <Button
          type="text"
          icon={<HiXMark className="h-4 w-4" />}
          disabled={disabled}
          onClick={onCancel}
          data-testid={workbenchSelectors.userTakeoverCancelButton}
        >
          取消本次任务
        </Button>
        <Button
          type="primary"
          icon={<HiCheck className="h-4 w-4" />}
          loading={confirming}
          disabled={disabled}
          onClick={onConfirm}
          className="!rounded-full !border-[#37352F] !bg-[#37352F] !text-white hover:!bg-[#2F3437]"
          data-testid={workbenchSelectors.userTakeoverConfirmButton}
        >
          完成并继续
        </Button>
      </div>
    </div>
  )
}

export default UserTakeoverPanel
