import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'

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
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 align-middle text-[13px] font-medium leading-5 text-[#0B6BCB] ${className}`}
      data-role={role}
    >
      <ReferenceIcon reference={reference} size="sm" />
      <span className="min-w-0 max-w-[180px] truncate">{reference.name}</span>
    </span>
  )
}

export default ReferenceInlineToken
