import React from 'react'
import FileIcon from '../../FileIcon'
import type { SelectedReference } from '../../../../../shared/types'
import { getReferenceVisualSpec } from './referenceVisuals'

type ReferenceIconProps = {
  reference: SelectedReference
  size?: 'sm' | 'md' | 'inline'
}

const iconSizeClassName = {
  sm: 'h-[18px] w-[18px]',
  md: 'h-[21px] w-[21px]',
  inline: 'h-[0.9em] w-[0.9em]'
} as const

const containerSizeClassName = {
  sm: 'h-[22px] w-[22px]',
  md: 'h-8 w-8',
  inline: 'relative top-[0.1em] h-[1em] w-[1em]'
} as const

export const ReferenceIcon: React.FC<ReferenceIconProps> = ({ reference, size = 'md' }) => {
  const visualSpec = getReferenceVisualSpec(reference)
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${containerSizeClassName[size]}`}
      data-reference-icon-kind={visualSpec.kind}
    >
      <FileIcon
        kind={visualSpec.kind}
        className={`${iconSizeClassName[size]} ${visualSpec.iconClassName}`}
      />
    </span>
  )
}

export default ReferenceIcon
