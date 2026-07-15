import type { ReactNode } from 'react'
import type {
  LLMConfig,
  WorkspaceIndexJobRecord,
  WorkspaceTreeEntry
} from '../../../../shared/types'

export type SettingsSectionValue = 'model' | 'workspace' | 'vector'

export type LlmConfigFormValues = Pick<LLMConfig, 'name' | 'providerKind' | 'base_url' | 'api_key'>

export type FlatModelOption = { value: string; label: string }
export type GroupedModelOption = { label: string; options: FlatModelOption[] }

export type WorkspaceTreeNode = {
  key: string
  title: ReactNode
  children?: WorkspaceTreeNode[]
}

export type WorkspaceTreeMap = Record<string, WorkspaceTreeEntry[]>
export type WorkspaceJobMap = Record<string, WorkspaceIndexJobRecord | undefined>
export type WorkspaceTreeDisplayStrategy = {
  defaultExpandDepth: number
  isLargeTree: boolean
  helperText: string
}

export type SettingsSectionMeta = {
  value: SettingsSectionValue
  label: string
  title: string
  description: string
  path: string
  icon: ReactNode
}

export type StatusBadgeVisual = {
  label: string
  className: string
  tooltip: string
  icon: ReactNode
}

export type ModelInfo = {
  id: string
  name: string
  description: string
  tags: string[]
  isDownloaded: boolean
}

export type DownloadStatus = 'downloading' | 'completed' | 'error'

export type DownloadProgressPayload = {
  repoId: string
  file?: string
  status: DownloadStatus
  progress: number
  totalFiles?: number
  completedFiles?: number
  error?: string
}

export type ActiveDownloadSnapshot = {
  repoId: string
  status: 'downloading'
  progress: number
  currentFile: string
  totalFiles: number
  completedFiles: number
  updatedAt: number
}
