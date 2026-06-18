import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'
import { getReferenceVisualTone } from './referenceVisuals'

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
  const tone = getReferenceVisualTone(reference)
  return (
    <span
      className={`inline-flex max-w-full items-center gap-0.5 align-baseline text-[13px] font-medium leading-5 ${tone.iconClassName} ${className}`}
      data-role={role}
    >
      <ReferenceIcon reference={reference} size="sm" variant="plain" />
      <span className="min-w-0 max-w-[180px] truncate">{reference.name}</span>
    </span>
  )
}

export default ReferenceInlineToken
