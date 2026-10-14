import FileIcon from '../FileIcon'
import React from 'react'
import { Modal } from 'antd'
import { HiCommandLine, HiExclamationTriangle, HiOutlineGlobeAlt } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'

export interface FullAccessConfirmModalProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const FullAccessConfirmModal: React.FC<FullAccessConfirmModalProps> = ({
  open,
  onConfirm,
  onCancel
}) => {
  return (
    <Modal
      open={open}
      title={
        <div className="flex items-center gap-2 text-[15px] font-semibold text-[#37352F]">
          <HiExclamationTriangle className="h-5 w-5 shrink-0 text-[#E85D04]" />
          <span>要开启完全访问权限吗？</span>
        </div>
      }
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid={workbenchSelectors.fullAccessConfirmCancelButton}
            className="rounded-[6px] border border-[#EEEEEC] bg-white px-3.5 py-1.5 text-[13px] font-normal text-[#37352F] transition-colors hover:bg-[#F4F4F2]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid={workbenchSelectors.fullAccessConfirmOkButton}
            className="flex items-center gap-1.5 rounded-[6px] border border-[#F8D7DA] bg-[#F8EBE9] px-3.5 py-1.5 text-[13px] font-medium text-[#B3261E] transition-colors hover:bg-[#F4DCDA]"
          >
            <HiExclamationTriangle className="h-3.5 w-3.5 shrink-0 text-[#B3261E]" />
            <span>确认开启</span>
          </button>
        </div>
      }
      maskClosable={false}
      width={500}
      className="[&_.ant-modal-content]:!rounded-[8px]"
      data-testid={workbenchSelectors.fullAccessConfirmModal}
    >
      <div className="flex flex-col gap-3.5 pt-1 text-[13px] leading-relaxed text-[#787774]">
        <p className="mb-0 text-[#37352F]">
          AI
          将能够在未经您许可的情况下，在这台计算机上的任何位置运行命令、使用互联网，以及创建、修改或删除文件。这包括但不限于：
        </p>

        <div className="flex flex-col overflow-hidden rounded-[8px] border border-[#EEEEEC] bg-[#FBFBFA]">
          <div className="flex items-start gap-3 p-3">
            <FileIcon kind="directory" className="h-5 w-5 shrink-0 mt-0.5 text-[#2563EB]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-[#37352F]">文件和文件夹</span>
              <span className="text-xs leading-5 text-[#787774]">
                读取、创建、修改、上传或删除此计算机上任意位置的文件
              </span>
            </div>
          </div>

          <div className="h-px bg-[#EEEEEC]" />

          <div className="flex items-start gap-3 p-3">
            <HiCommandLine className="h-5 w-5 shrink-0 mt-0.5 text-[#37352F]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-[#37352F]">终端命令</span>
              <span className="text-xs leading-5 text-[#787774]">
                运行命令、安装软件和更改系统设置
              </span>
            </div>
          </div>

          <div className="h-px bg-[#EEEEEC]" />

          <div className="flex items-start gap-3 p-3">
            <HiOutlineGlobeAlt className="h-5 w-5 shrink-0 mt-0.5 text-[#0284C7]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-[#37352F]">互联网和已连接的应用</span>
              <span className="text-xs leading-5 text-[#787774]">
                访问网站、发送数据并使用已启用的插件
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[6px] border border-[#FBE3D5] bg-[#FBF3DB] p-2.5 text-xs leading-relaxed text-[#B45309]">
          ⚠️ 这会带来敏感数据丢失或泄露、提示注入等风险。你可以随时将其切回「审核」模式。
        </div>
      </div>
    </Modal>
  )
}
