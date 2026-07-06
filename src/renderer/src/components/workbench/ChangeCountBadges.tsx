import React from 'react'

type ChangeCountBadgesProps = {
  insertCount: number
  deleteCount: number
  mode?: 'compact' | 'full'
  className?: string
}

const ChangeCountBadges: React.FC<ChangeCountBadgesProps> = ({
  insertCount,
  deleteCount,
  mode = 'full',
  className
}) => {
  if (mode === 'compact' && insertCount <= 0 && deleteCount <= 0) return null
  const showInsertCount = mode === 'full' || insertCount > 0
  const showDeleteCount = mode === 'full' || deleteCount > 0

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 ${className || ''}`}>
      {showInsertCount ? (
        <span className="inline-flex items-center text-[11px] font-semibold leading-none tabular-nums text-[#147A3D]">
          +{insertCount}
        </span>
      ) : null}
      {showDeleteCount ? (
        <span className="inline-flex items-center text-[11px] font-semibold leading-none tabular-nums text-[#B42318]">
          -{deleteCount}
        </span>
      ) : null}
    </span>
  )
}

export default ChangeCountBadges
