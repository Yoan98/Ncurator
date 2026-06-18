import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'

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
}) => (
  <span
    className={`inline-flex max-w-full items-center gap-1.5 rounded-[6px] border border-[#E0DFDC] bg-white px-1.5 py-[1px] align-baseline text-[13px] font-medium leading-5 text-[#2F3437] shadow-[0_1px_0_rgba(15,15,15,0.03)] ${className}`}
    data-role={role}
  >
    <ReferenceIcon reference={reference} size="sm" />
    <span className="min-w-0 max-w-[180px] truncate">{reference.name}</span>
    {removable ? (
      <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] leading-none text-[#9B9A97]">
        ×
      </span>
    ) : null}
  </span>
)

export default ReferenceInlineToken
