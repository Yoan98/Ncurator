import React from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import { getReferenceVisualSpec } from './referenceVisuals'

type ReferenceIconProps = {
  reference: SelectedReference
  size?: 'sm' | 'md' | 'inline'
}

const iconSizeClassName = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  inline: 'h-[1em] w-[1em]'
} as const

const containerSizeClassName = {
  sm: 'h-[18px] w-[18px]',
  md: 'h-7 w-7',
  inline: 'h-[1.15em] w-[1.15em]'
} as const

const DocumentGlyph: React.FC<{
  className: string
  fillClassName: string
  accentClassName: string
  label?: string
}> = ({ className, fillClassName, accentClassName, label }) => {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
      <path
        className={fillClassName}
        d="M4.3 1.7h6.5l3.1 3.1v10.4c0 .7-.6 1.2-1.2 1.2H4.3c-.7 0-1.2-.6-1.2-1.2V2.9c0-.7.5-1.2 1.2-1.2z"
      />
      {label ? null : <path className="fill-white" d="M4.3 2.7h6.1l2.5 2.5v10.1H4.3V2.7z" />}
      <path className={accentClassName} d="M10.4 1.7v3.4h3.5l-3.5-3.4z" />
      {label ? (
        <text
          x="8.55"
          y="11.2"
          className="fill-white"
          dominantBaseline="middle"
          fontFamily="Arial, sans-serif"
          fontSize="4"
          fontWeight="700"
          textAnchor="middle"
        >
          {label}
        </text>
      ) : (
        <path
          className={accentClassName}
          d="M6 7.2h5.1v1.2H6zM6 9.4h5.1v1.2H6zM6 11.6h3.6v1.2H6z"
        />
      )}
    </svg>
  )
}

export const ReferenceIcon: React.FC<ReferenceIconProps> = ({ reference, size = 'md' }) => {
  const visualSpec = getReferenceVisualSpec(reference)
  const iconClassName = `${iconSizeClassName[size]} ${visualSpec.iconClassName}`

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${containerSizeClassName[size]}`}
      data-reference-icon-kind={visualSpec.kind}
    >
      {visualSpec.kind !== 'directory' && visualSpec.kind !== 'web' ? (
        <DocumentGlyph
          className={iconClassName}
          fillClassName={visualSpec.documentFillClassName}
          accentClassName={visualSpec.documentAccentClassName}
          label={visualSpec.documentLabel}
        />
      ) : (
        <svg
          className={iconClassName}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {visualSpec.kind === 'directory' ? (
            <path d="M3.5 6.5h5.15l1.45 1.65h10.4v8.9c0 .8-.65 1.45-1.45 1.45H4.95c-.8 0-1.45-.65-1.45-1.45V6.5z" />
          ) : (
            <>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M3.5 12h17M12 3.5c2.15 2.2 3.2 5.05 3.2 8.5s-1.05 6.3-3.2 8.5M12 3.5C9.85 5.7 8.8 8.55 8.8 12s1.05 6.3 3.2 8.5" />
            </>
          )}
        </svg>
      )}
    </span>
  )
}

export default ReferenceIcon
