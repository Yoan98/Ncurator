import React, { useMemo } from 'react'
import type { WorkspaceSource } from '../../../../shared/types'
import { formatWorkspacePathLabel, getWorkspacePathParts } from './pathDisplay'

type WorkspacePathLabelProps = {
  filePath: string | undefined
  workspaces: WorkspaceSource[]
  fallbackWorkspaceName?: string | null
  className?: string
  prefixClassName?: string
  fileNameClassName?: string
}

const splitPathForDisplay = (
  filePath: string | undefined,
  workspaces: WorkspaceSource[],
  fallbackWorkspaceName?: string | null
): {
  label: string
  prefix: string
  fileName: string
} => {
  const parts = getWorkspacePathParts(filePath, workspaces)
  const workspaceName = String(parts.workspaceName || fallbackWorkspaceName || '').trim()
  const relativePath = String(parts.relativePath || parts.fileName || '').replace(/\\/g, '/')
  const fileName = parts.fileName || relativePath.split('/').filter(Boolean).pop() || relativePath
  const directoryPath = relativePath.endsWith(fileName)
    ? relativePath.slice(0, Math.max(0, relativePath.length - fileName.length)).replace(/\/+$/g, '')
    : ''
  const prefix = [workspaceName, ...directoryPath.split('/').filter(Boolean)]
    .filter(Boolean)
    .join(' > ')
  return {
    label: formatWorkspacePathLabel(filePath, workspaces, fallbackWorkspaceName),
    prefix: prefix ? `${prefix} > ` : '',
    fileName
  }
}

const WorkspacePathLabel: React.FC<WorkspacePathLabelProps> = ({
  filePath,
  workspaces,
  fallbackWorkspaceName,
  className,
  prefixClassName,
  fileNameClassName
}) => {
  const display = useMemo(
    () => splitPathForDisplay(filePath, workspaces, fallbackWorkspaceName),
    [fallbackWorkspaceName, filePath, workspaces]
  )

  if (!display.prefix) {
    return (
      <span title={display.label} className={`block min-w-0 truncate ${className || ''}`}>
        <span className={fileNameClassName || 'text-[#37352F]'}>{display.fileName}</span>
      </span>
    )
  }

  return (
    <span title={display.label} className={`block min-w-0 truncate ${className || ''}`}>
      <span className={prefixClassName || 'text-[#9B9A97]'}>{display.prefix}</span>
      <span className={fileNameClassName || 'text-[#37352F]'}>{display.fileName}</span>
    </span>
  )
}

export default WorkspacePathLabel
