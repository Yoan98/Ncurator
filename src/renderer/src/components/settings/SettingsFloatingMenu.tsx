import React from 'react'
import SettingsMenuButton from './SettingsMenuButton'

const SettingsFloatingMenu: React.FC = () => {
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-30 sm:bottom-6 sm:left-6">
      <div className="pointer-events-auto">
        <SettingsMenuButton
          placement="topLeft"
          bare
          iconClassName="h-6 w-6"
          className="h-12 w-12 p-0 text-[#6E6D69]"
        />
      </div>
    </div>
  )
}

export default SettingsFloatingMenu
