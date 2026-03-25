import React from 'react'
import { Tag, Tooltip } from 'antd'

type StatusTagProps = {
  label: string
  className: string
  tooltip: string
  icon: React.ReactNode
  dataTestId?: string
}

const StatusTag: React.FC<StatusTagProps> = ({ label, className, tooltip, icon, dataTestId }) => {
  return (
    <Tooltip title={tooltip}>
      <Tag className={`!mr-0 rounded-full ${className}`} data-testid={dataTestId}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center">{icon}</span>
          <span>{label}</span>
        </span>
      </Tag>
    </Tooltip>
  )
}

export default StatusTag
