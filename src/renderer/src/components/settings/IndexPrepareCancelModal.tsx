import { t } from '../../i18n'
import React from 'react'
import { Modal } from 'antd'

type IndexPrepareCancelModalProps = {
  open: boolean
  confirmTestId: string
  continueTestId: string
  onStop: () => void
  onContinue: () => void
}

const IndexPrepareCancelModal: React.FC<IndexPrepareCancelModalProps> = ({
  open,
  confirmTestId,
  continueTestId,
  onStop,
  onContinue
}) => {
  return (
    <Modal
      title={t(($) => $.settings.stopUpdatingTheIndex)}
      open={open}
      maskClosable={false}
      onCancel={onContinue}
      onOk={onStop}
      okText={t(($) => $.common.stop)}
      cancelText={t(($) => $.settings.continueUpdating)}
      okButtonProps={{ 'data-testid': confirmTestId }}
      cancelButtonProps={{ 'data-testid': continueTestId }}
      className="[&_.ant-modal-content]:!rounded-[8px]"
    >
      <p className="mb-0 text-[#787774]">
        {t(($) => $.settings.unfinishedItemsWillStopIndexingCompletedIndexesWillBe)}
      </p>
    </Modal>
  )
}

export default IndexPrepareCancelModal
