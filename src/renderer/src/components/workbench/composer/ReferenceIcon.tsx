import React from 'react'
import { HiDocument, HiDocumentText, HiFolder, HiGlobeAlt } from 'react-icons/hi2'
import type { SelectedReference } from '../../../../../shared/types'
import { getReferenceVisualKind, getReferenceVisualTone } from './referenceVisuals'

type ReferenceIconProps = {
  reference: SelectedReference
  size?: 'sm' | 'md'
  variant?: 'badge' | 'plain'
}

const iconSizeClassName = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4'
} as const

const containerSizeClassName = {
  sm: 'h-[18px] w-[18px] rounded-[4px]',
  md: 'h-7 w-7 rounded-[6px]'
} as const

export const ReferenceIcon: React.FC<ReferenceIconProps> = ({
  reference,
  size = 'md',
  variant = 'badge'
}) => {
  const visualKind = getReferenceVisualKind(reference)
  const tone = getReferenceVisualTone(reference)
  const iconClassName = `${iconSizeClassName[size]} ${tone.iconClassName}`
  const containerToneClassName = variant === 'badge' ? tone.containerClassName : tone.iconClassName

  const icon =
    visualKind === 'directory' ? (
      <HiFolder className={iconClassName} />
    ) : visualKind === 'web' ? (
      <HiGlobeAlt className={iconClassName} />
    ) : visualKind === 'docx' || visualKind === 'pdf' ? (
      <HiDocumentText className={iconClassName} />
    ) : (
      <HiDocument className={iconClassName} />
    )

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${containerSizeClassName[size]} ${containerToneClassName}`}
      data-reference-icon-kind={visualKind}
    >
      {icon}
    </span>
  )
}

export default ReferenceIcon
