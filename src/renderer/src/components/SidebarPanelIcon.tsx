import React from 'react'

type SidebarPanelIconProps = {
  className?: string
  variant?: 'collapse' | 'expand'
}

const SidebarPanelIcon: React.FC<SidebarPanelIconProps> = ({ className, variant = 'collapse' }) => {
  const dividerX = variant === 'collapse' ? 5.5 : 10.5

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="3.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={`M${dividerX} 3.75V12.25`}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default SidebarPanelIcon
