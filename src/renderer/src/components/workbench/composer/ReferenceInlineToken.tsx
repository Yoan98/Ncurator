import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'
import { getReferenceVisualTone } from './referenceVisuals'

type ReferenceInlineTokenProps = {
  reference: SelectedReference
  removable?: boolean
  className?: string
  role?: 'scope-token' | 'reference-inline-token'
}

export const ReferenceInlineToken: React.FC<ReferenceInlineTokenProps> = ({
  reference,
  removable = false,
  className = '',
  role = 'reference-inline-token'
}) => {
  const tone = getReferenceVisualTone(reference)
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 align-baseline text-[13px] font-medium leading-5 ${tone.iconClassName} ${className}`}
      data-role={role}
    >
      <ReferenceIcon reference={reference} size="sm" variant="plain" />
      <span className="min-w-0 max-w-[180px] truncate">{reference.name}</span>
      {removable ? (
        <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none text-current opacity-40 transition hover:bg-[#F1F1F0] hover:opacity-80">
          ×
        </span>
      ) : null}
    </span>
  )
}

export default ReferenceInlineToken
