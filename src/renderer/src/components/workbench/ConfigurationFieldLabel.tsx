import type { ReactNode } from 'react'

export default function ConfigurationFieldLabel({
  children,
  required = false
}: {
  children: ReactNode
  required?: boolean
}) {
  return (
    <span className="nc-configuration-field-label block text-[13px] leading-5 text-[#37352F]">
      {required && (
        <span className="mr-1 text-[#ff4d4f]" aria-hidden="true">
          *
        </span>
      )}
      {children}
    </span>
  )
}
