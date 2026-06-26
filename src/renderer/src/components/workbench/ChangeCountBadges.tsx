import React from 'react'

type ChangeCountBadgesProps = {
  insertCount: number
  deleteCount: number
  className?: string
}

const ChangeCountBadges: React.FC<ChangeCountBadgesProps> = ({
  insertCount,
  deleteCount,
  className
}) => {
  if (insertCount <= 0 && deleteCount <= 0) return null

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className || ''}`}>
      {insertCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-[#E7F6EC] px-1.5 text-[11px] font-semibold leading-none tabular-nums text-[#147A3D]">
          +{insertCount}
        </span>
      ) : null}
      {deleteCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-[#FDECEC] px-1.5 text-[11px] font-semibold leading-none tabular-nums text-[#B42318]">
          -{deleteCount}
        </span>
      ) : null}
    </span>
  )
}

export default ChangeCountBadges
