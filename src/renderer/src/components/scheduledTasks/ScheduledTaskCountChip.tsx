import React from 'react'

type ScheduledTaskCountChipProps = {
  enabledCount: number
  className?: string
  dataTestId?: string
}

/** 侧栏 / 标题栏已启用定时任务数量 chip；enabledCount 为 0 时不渲染。 */
const ScheduledTaskCountChip: React.FC<ScheduledTaskCountChipProps> = ({
  enabledCount,
  className,
  dataTestId
}) => {
  if (enabledCount <= 0) return null
  return (
    <span
      className={['nc-scheduled-task-count-chip', className].filter(Boolean).join(' ')}
      data-testid={dataTestId}
      aria-hidden="true"
    >
      {enabledCount}
    </span>
  )
}

export default ScheduledTaskCountChip
