import FileIcon from '../../FileIcon'
import { DIRECTORY_ICON_SIZE_CLASSES, FILE_ICON_SIZE_CLASSES } from '../../../utils/fileIcons'
import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import { getReferenceVisualSpec } from './referenceVisuals'

type ReferenceIconProps = {
  reference: SelectedReference
  size?: 'sm' | 'md' | 'inline'
}

const containerSizeClassName = {
  sm: 'h-[22px] w-[22px]',
  md: 'h-8 w-8',
  inline: 'relative top-[0.15em] h-[18px] w-[18px]'
} as const

const ReferenceIcon: React.FC<ReferenceIconProps> = ({ reference, size = 'md' }) => {
  const visualSpec = getReferenceVisualSpec(reference)
  const iconSize =
    visualSpec.kind === 'directory'
      ? DIRECTORY_ICON_SIZE_CLASSES[size]
      : FILE_ICON_SIZE_CLASSES[size]
  const iconClassName = `${iconSize} ${visualSpec.iconClassName}`

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${containerSizeClassName[size]}`}
      data-reference-icon-kind={visualSpec.kind}
    >
      <FileIcon kind={visualSpec.kind} className={iconClassName} />
    </span>
  )
}

export default ReferenceIcon
