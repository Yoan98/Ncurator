import type { ReactNode } from 'react'
import type {
  LLMConfig,
  WorkspaceIndexJobRecord,
  WorkspaceTreeEntry
} from '../../../../shared/types'

export type SettingsSectionValue = 'model' | 'workspace' | 'app'

export type LlmConfigFormValues = Pick<LLMConfig, 'providerKind' | 'base_url' | 'api_key'>

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
