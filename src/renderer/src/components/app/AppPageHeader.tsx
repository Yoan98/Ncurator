import React from 'react'
import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { HiArrowLeft } from 'react-icons/hi2'
import brandIcon from '../../../../../resources/icon.png'

type AppPageHeaderProps = {
  icon: React.ReactNode
  title: string
  description?: string
  actions?: React.ReactNode
  navigationMode?: 'brand' | 'back'
  backTo?: string
}

const AppPageHeader: React.FC<AppPageHeaderProps> = ({
  icon,
  title,
  description,
  actions,
  navigationMode = 'brand',
  backTo
}) => {
  const navigate = useNavigate()

  if (navigationMode === 'back') {
    return (
      <header className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="text"
            onClick={() => navigate(backTo || '/')}
            className="!flex !h-9 !w-9 !items-center !justify-center !rounded-[6px] !border !border-[#EEEEEC] !bg-white !p-0 !text-[#787774] shadow-none hover:!border-[#37352F] hover:!text-[#37352F]"
            icon={<HiArrowLeft className="h-[18px] w-[18px]" />}
          />
          <div className="flex min-w-0 items-center gap-2 text-[#37352F]">
            <span className="ui-icon-well ui-icon-well-brand flex h-9 w-9">{icon}</span>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-[#37352F]">
                {title}
              </h1>
              {description ? (
                <p className="truncate text-[12px] text-[#787774]">{description}</p>
              ) : null}
            </div>
          </div>
        </div>

        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
    )
  }

  return (
    <header className="flex flex-col gap-4 pb-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="text"
            onClick={() => navigate('/')}
            className="!flex !h-10 !items-center !gap-2 !rounded-[6px] !border !border-[#EEEEEC] !bg-white !px-3 !text-[#37352F] shadow-none hover:!border-[#37352F] hover:!text-[#37352F]"
          >
            <span className="ui-icon-well ui-icon-well-brand flex h-7 w-7 border-none">
              <img src={brandIcon} alt="馆长" className="w-5 invert-100" />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.01em]">馆长</span>
          </Button>
          <span className="text-[#E0DFDC]">/</span>
          <div className="flex min-w-0 items-center gap-2 text-[#37352F]">
            <span className="ui-icon-well ui-icon-well-brand flex h-9 w-9">{icon}</span>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-[#37352F]">
                {title}
              </h1>
              {description ? (
                <p className="truncate text-[12px] text-[#787774]">{description}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export default AppPageHeader
