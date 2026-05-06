import type { ReactNode } from 'react'
import type {
  LLMConfig,
  WorkspaceNode,
  WorkspacePrepareMode,
  WorkspaceSource,
  WorkspaceSyncProgress
} from '../../../../shared/types'

export type SettingsSectionValue = 'model' | 'workspace'

export type LlmConfigFormValues = Pick<
  LLMConfig,
  'name' | 'providerKind' | 'base_url' | 'model_name' | 'api_key'
>

export type FlatModelOption = { value: string; label: string }
export type GroupedModelOption = { label: string; options: FlatModelOption[] }

export type WorkspaceTreeNode = {
  key: string
  title: ReactNode
  children?: WorkspaceTreeNode[]
}

export type WorkspaceNodeMap = Record<string, WorkspaceNode[]>
export type WorkspaceActionMap = Record<string, 'scan' | 'prepare' | undefined>
export type WorkspaceProgressMap = Record<string, WorkspaceSyncProgress | undefined>
export type WorkspaceModeMap = Record<string, WorkspacePrepareMode>
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

export type WorkspaceAction = 'scan' | 'prepare'

export type WorkspaceStatusBadgeInput = {
  status: WorkspaceSource['status']
  lastScanAt?: number
  lastPrepareAt?: number
  lastError?: string
  action?: WorkspaceAction
  progress?: WorkspaceSyncProgress
}
