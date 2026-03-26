import React from 'react'
import { Button, Dropdown } from 'antd'
import type { DropdownProps } from 'antd'
import { useNavigate } from 'react-router-dom'
import { HiOutlineCog6Tooth } from 'react-icons/hi2'
import { APP_MENU_ITEMS } from './constants'

type SettingsMenuButtonProps = {
  label?: string
  className?: string
  placement?: DropdownProps['placement']
  iconClassName?: string
  bare?: boolean
}

const SettingsMenuButton: React.FC<SettingsMenuButtonProps> = ({
  label,
  className,
  placement = 'bottomRight',
  iconClassName,
  bare = false
}) => {
  const navigate = useNavigate()
  const iconOnly = !label

  return (
    <Dropdown
      trigger={['click']}
      placement={placement}
      menu={{
        items: APP_MENU_ITEMS.map((item) => ({
          key: item.key,
          label: (
            <div className="min-w-[152px] py-0.5">
              <div className="flex items-center gap-3 text-[13px] font-medium text-[#1F1F1F]">
                <span className="ui-icon-well flex h-7 w-7 text-[#666666]">{item.icon}</span>
                <span>{item.label}</span>
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
      {bare ? (
        <button
          type="button"
          aria-label="设置"
          className={`inline-flex items-center justify-center text-[#666666] transition-colors hover:text-[#D97757] ${className || ''}`}
        >
          <HiOutlineCog6Tooth className={iconClassName || 'h-3.5 w-3.5'} />
          {label ? <span className="ml-2">{label}</span> : null}
        </button>
      ) : (
        <Button
          icon={<HiOutlineCog6Tooth className={iconClassName || 'h-3.5 w-3.5'} />}
          aria-label="设置"
          className={`!inline-flex !h-9 !items-center !rounded-[10px] !border-[#E5E5E4] !bg-white !text-[#666666] !shadow-none hover:!border-[#D97757] hover:!text-[#D97757] ${
            iconOnly ? '!w-9 !justify-center !px-0' : '!px-3'
          } ${className || ''}`}
        >
          {label}
        </Button>
      )}
    </Dropdown>
  )
}

export default SettingsMenuButton
