import React, { useMemo } from 'react'
import type { WorkspaceSource } from '../../../../shared/types'
import {
  getWorkspacePathLabelParts,
  type WorkspacePathSeparator
} from '../../../../shared/workbench/pathDisplay'

type WorkspacePathLabelProps = {
  filePath: string | undefined
  workspaces: WorkspaceSource[]
  className?: string
  prefixClassName?: string
  fileNameClassName?: string
  separator?: WorkspacePathSeparator
}

const WorkspacePathLabel: React.FC<WorkspacePathLabelProps> = ({
  filePath,
  workspaces,
  className,
  prefixClassName,
  fileNameClassName,
  separator = ' > '
}) => {
  const display = useMemo(
    () => getWorkspacePathLabelParts(filePath, workspaces, separator),
    [filePath, separator, workspaces]
  )

  if (!display.prefix) {
    return (
      <span title={display.label} className={`block min-w-0 truncate ${className || ''}`}>
        <span className={fileNameClassName || 'text-[var(--notion-text)]'}>{display.fileName}</span>
      </span>
    )
  }

  return (
    <span title={display.label} className={`block min-w-0 truncate ${className || ''}`}>
      <span className={prefixClassName || 'text-[var(--notion-text-faint)]'}>{display.prefix}</span>
      <span className={fileNameClassName || 'text-[var(--notion-text)]'}>{display.fileName}</span>
    </span>
  )
}

export default WorkspacePathLabel
