import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceIcon from './ReferenceIcon'
import { INLINE_TOKEN_LABEL_CLASS_NAME, REFERENCE_TOKEN_CLASS_NAME } from './referenceVisuals'

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
      className={`${REFERENCE_TOKEN_CLASS_NAME} ${className}`}
      data-role={role}
      title={reference.name}
    >
      <ReferenceIcon reference={reference} size="inline" />
      <span className={INLINE_TOKEN_LABEL_CLASS_NAME}>{reference.name}</span>
    </span>
  )
}

export default ReferenceInlineToken
