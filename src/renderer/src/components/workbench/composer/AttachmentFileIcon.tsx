import React from 'react'
import type { FileReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'
import { getReferenceVisualSpec } from './referenceVisuals'

type AttachmentFileIconProps = {
  fileName: string
  className?: string
  /** 尺寸类单独传，避免与默认尺寸在 Tailwind 中互相覆盖失败 */
  sizeClassName?: string
}

const getFileExtension = (fileName: string): string => {
  const lastSegment = String(fileName || '')
    .split(/[\\/]/u)
    .pop()
  if (!lastSegment) return ''
  const dotIndex = lastSegment.lastIndexOf('.')
  return dotIndex > -1
    ? lastSegment
        .slice(dotIndex + 1)
        .trim()
        .toLowerCase()
    : ''
}

const createAttachmentFileReference = (fileName: string): FileReference => ({
  kind: 'file',
  workspaceId: '',
  nodeId: `attachment:${fileName}`,
  name: fileName,
  relativePath: fileName,
  absolutePath: '',
  fileExt: getFileExtension(fileName),
  kbDocumentIds: [],
  kbAvailability: 'not_indexed'
})

export const AttachmentFileIcon: React.FC<AttachmentFileIconProps> = ({
  fileName,
  className = '',
  sizeClassName = 'h-8 w-8'
}) => {
  const reference = createAttachmentFileReference(fileName)
  const visualSpec = getReferenceVisualSpec(reference)

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[8px] bg-[#F4F4F2] ${sizeClassName} ${visualSpec.iconClassName} ${className}`}
    >
      <ReferenceIcon reference={reference} size="md" />
    </span>
  )
}

export default AttachmentFileIcon
