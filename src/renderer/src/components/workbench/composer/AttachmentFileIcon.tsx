import type { FC } from 'react'
import FileIcon from '../../FileIcon'

type AttachmentFileIconProps = {
  fileName: string
  className?: string
  sizeClassName?: string
}

const AttachmentFileIcon: FC<AttachmentFileIconProps> = ({
  fileName,
  className = '',
  sizeClassName = 'h-8 w-8'
}) => (
  <span
    className={`flex shrink-0 items-center justify-center rounded-[8px] bg-[#F4F4F2] ${sizeClassName} ${className}`}
  >
    <FileIcon name={fileName} className="h-[21px] w-[21px] text-[#787774]" />
  </span>
)

export default AttachmentFileIcon
