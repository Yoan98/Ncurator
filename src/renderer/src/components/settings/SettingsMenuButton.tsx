import React from 'react'
import { Button, Dropdown } from 'antd'
import { useNavigate } from 'react-router-dom'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import { APP_MENU_ITEMS } from './constants'

type SettingsMenuButtonProps = {
  label?: string
  className?: string
}

const SettingsMenuButton: React.FC<SettingsMenuButtonProps> = ({ label, className }) => {
  const navigate = useNavigate()

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items: APP_MENU_ITEMS.map((item) => ({
          key: item.key,
          label: (
            <div className="min-w-[188px] py-1">
              <div className="flex items-center gap-3 text-[13px] font-medium text-[#1F1F1F]">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#E5E5E4] bg-[#FAFAF9] text-[#666666]">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              <div className="mt-1 pl-[44px] text-[12px] leading-5 text-[#999999]">
                {item.description}
              </div>
            </div>
          )
        })),
        onClick: ({ key }) => {
          const target = APP_MENU_ITEMS.find((item) => item.key === key)
          if (target) {
            navigate(target.path)
          }
        }
      }}
    >
      <Button
        icon={<HiOutlineCog6Tooth className="h-[18px] w-[18px]" />}
        className={`!inline-flex !h-10 !items-center !rounded-2xl !border-[#E5E5E4] !bg-white/92 !px-3 !text-[#666666] shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm hover:!border-[#D97757] hover:!text-[#D97757] ${className || ''}`}
      >
        {label}
      </Button>
    </Dropdown>
  )
}

export default SettingsMenuButton
