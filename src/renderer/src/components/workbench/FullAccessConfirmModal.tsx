import { t } from '../../i18n'
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
        <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--notion-text)]">
          <HiExclamationTriangle className="h-5 w-5 shrink-0 text-[var(--notion-warning)]" />
          <span>{t(($) => $.workbench.enableFullAccess)}</span>
        </div>
      }
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid={workbenchSelectors.fullAccessConfirmCancelButton}
            className="rounded-[6px] border border-[var(--notion-line)] bg-[var(--notion-page)] px-3.5 py-1.5 text-[13px] font-normal text-[var(--notion-text)] transition-colors hover:bg-[var(--notion-surface)]"
          >
            {t(($) => $.common.cancel)}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid={workbenchSelectors.fullAccessConfirmOkButton}
            className="flex items-center gap-1.5 rounded-[6px] border border-[var(--notion-red-line)] bg-[var(--notion-red-bg)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--notion-red)] transition-colors hover:bg-[var(--notion-red-bg-hover)]"
          >
            <HiExclamationTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--notion-red)]" />
            <span>{t(($) => $.workbench.enable)}</span>
          </button>
        </div>
      }
      maskClosable={false}
      width={500}
      className="[&_.ant-modal-content]:!rounded-[8px]"
      data-testid={workbenchSelectors.fullAccessConfirmModal}
    >
      <div className="flex flex-col gap-3.5 pt-1 text-[13px] leading-relaxed text-[var(--notion-text-soft)]">
        <p className="mb-0 text-[var(--notion-text)]">
          {t(($) => $.workbench.aiWillBeAbleToRunCommandsUseThe)}
        </p>

        <div className="flex flex-col overflow-hidden rounded-[8px] border border-[var(--notion-line)] bg-[var(--notion-sidebar)]">
          <div className="flex items-start gap-3 p-3">
            <FileIcon kind="directory" className="h-5 w-5 shrink-0 mt-0.5 text-[var(--file-icon-doc)]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-[var(--notion-text)]">
                {t(($) => $.workbench.filesAndFolders)}
              </span>
              <span className="text-xs leading-5 text-[var(--notion-text-soft)]">
                {t(($) => $.workbench.readCreateModifyUploadOrDeleteFilesAnywhereOn)}
              </span>
            </div>
          </div>

          <div className="h-px bg-[var(--notion-line)]" />

          <div className="flex items-start gap-3 p-3">
            <HiCommandLine className="h-5 w-5 shrink-0 mt-0.5 text-[var(--notion-text)]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-[var(--notion-text)]">
                {t(($) => $.workbench.terminalCommand)}
              </span>
              <span className="text-xs leading-5 text-[var(--notion-text-soft)]">
                {t(($) => $.workbench.runCommandsInstallSoftwareAndChangeSystemSettings)}
              </span>
            </div>
          </div>

          <div className="h-px bg-[var(--notion-line)]" />

          <div className="flex items-start gap-3 p-3">
            <HiOutlineGlobeAlt className="h-5 w-5 shrink-0 mt-0.5 text-[var(--notion-blue)]" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-[var(--notion-text)]">
                {t(($) => $.workbench.internetAndConnectedApps)}
              </span>
              <span className="text-xs leading-5 text-[var(--notion-text-soft)]">
                {t(($) => $.workbench.visitWebsitesSendDataAndUseEnabledPlugins)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[6px] border border-[var(--notion-warning-bg)] bg-[var(--notion-yellow-bg)] p-2.5 text-xs leading-relaxed text-[var(--notion-warning-text)]">
          {t(($) => $.workbench.thisCanLeadToDataLossDisclosureOrPrompt)}
        </div>
      </div>
    </Modal>
  )
}
