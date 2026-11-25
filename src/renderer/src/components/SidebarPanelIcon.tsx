import React from 'react'
import { LuPanelLeft, LuPanelRight } from 'react-icons/lu'

type SidebarPanelIconProps = {
  className?: string
  variant?: 'collapse' | 'expand'
}

const SidebarPanelIcon: React.FC<SidebarPanelIconProps> = ({ className, variant = 'collapse' }) => {
  const Icon = variant === 'collapse' ? LuPanelLeft : LuPanelRight
  return <Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${className ?? ''}`} />
}

export default SidebarPanelIcon
