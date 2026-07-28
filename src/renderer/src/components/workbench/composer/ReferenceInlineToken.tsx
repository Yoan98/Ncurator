import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'
import { getReferenceVisualSpec } from './referenceVisuals'

type ReferenceInlineTokenProps = {
  reference: SelectedReference
  className?: string
  role?: 'scope-token' | 'reference-inline-token'
}

export const ReferenceInlineToken: React.FC<ReferenceInlineTokenProps> = ({
  reference,
  className = '',
  role = 'reference-inline-token'
}) => {
  const visualSpec = getReferenceVisualSpec(reference)

  return (
    <span
      className={`inline-flex max-w-full items-center gap-[2px] align-[-0.08em] text-[0.9em] font-medium leading-[inherit] ${visualSpec.labelClassName} ${className}`}
      data-role={role}
    >
      <ReferenceIcon reference={reference} size="inline" />
      <span className="min-w-0 max-w-[180px] truncate">{reference.name}</span>
    </span>
  )
}

export default ReferenceInlineToken
