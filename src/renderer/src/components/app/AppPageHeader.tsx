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
      <header className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="text"
            onClick={() => navigate(backTo || '/')}
            className="!flex !h-9 !w-9 !items-center !justify-center !rounded-xl !border !border-[#E5E5E4] !bg-white/88 !p-0 !text-[#666666] shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm hover:!border-[#D97757] hover:!text-[#D97757]"
            icon={<HiArrowLeft className="h-[18px] w-[18px]" />}
          />
          <div className="flex min-w-0 items-center gap-2 text-[#1F1F1F]">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[#E5E5E4] bg-white text-[#D97757] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {icon}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-[#1F1F1F]">
                {title}
              </h1>
              {description ? (
                <p className="truncate text-[13px] text-[#666666]">{description}</p>
              ) : null}
            </div>
          </div>
        </div>

        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
    )
  }

  return (
    <header className="flex flex-col gap-4 pb-5 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="text"
            onClick={() => navigate('/')}
            className="!flex !h-10 !items-center !gap-2 !rounded-2xl !border !border-[#E5E5E4] !bg-white/85 !px-3 !text-[#1F1F1F] shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm hover:!border-[#D97757] hover:!text-[#D97757]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#FBF5F2]">
              <img src={brandIcon} alt="馆长" className="w-5 invert-100" />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.01em]">馆长</span>
          </Button>
          <span className="text-[#D4D4D3]">/</span>
          <div className="flex min-w-0 items-center gap-2 text-[#1F1F1F]">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[#E5E5E4] bg-white text-[#D97757] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {icon}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-[#1F1F1F]">
                {title}
              </h1>
              {description ? (
                <p className="truncate text-[13px] text-[#666666]">{description}</p>
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
