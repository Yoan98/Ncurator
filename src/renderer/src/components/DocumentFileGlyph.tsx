import type React from 'react'

const DocumentFileGlyph: React.FC<
  {
    className: string
    fillClassName: string
    accentClassName: string
    label?: string
  } & React.SVGProps<SVGSVGElement>
> = ({ className, fillClassName, accentClassName, label, ...svgProps }) => {
  return (
    <svg {...svgProps} className={className} viewBox="0 0 18 18" aria-hidden="true">
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

export default DocumentFileGlyph
