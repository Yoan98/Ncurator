import React from 'react'
import { Modal } from 'antd'

type IndexPrepareCancelModalProps = {
  open: boolean
  content: string
  confirmTestId: string
  continueTestId: string
  onStop: () => void
  onContinue: () => void
}

const IndexPrepareCancelModal: React.FC<IndexPrepareCancelModalProps> = ({
  open,
  content,
  confirmTestId,
  continueTestId,
  onStop,
  onContinue
}) => {
  return (
    <Modal
      title="停止更新索引？"
      open={open}
      maskClosable={false}
      onCancel={onContinue}
      onOk={onStop}
      okText="停止"
      cancelText="继续更新"
      okButtonProps={{ 'data-testid': confirmTestId }}
      cancelButtonProps={{ 'data-testid': continueTestId }}
      className="[&_.ant-modal-content]:!rounded-[8px]"
    >
      <p className="mb-0 text-[#787774]">{content}</p>
    </Modal>
  )
}

export default IndexPrepareCancelModal
