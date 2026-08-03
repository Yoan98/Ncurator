import type { WorkbenchFileOrigin } from './types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed.v2'
export const WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY = 'workbench.sidebar.width'
export const WORKBENCH_SIDEBAR_DEFAULT_WIDTH = 240
export const WORKBENCH_SIDEBAR_MIN_WIDTH = 220
export const WORKBENCH_SIDEBAR_MAX_WIDTH = 320
export const WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH = 170
export const WORKBENCH_LEGACY_PREFERENCE_STORAGE_KEYS = [
  'workbench.preference.mode',
  'workbench.preference.ai-preference',
  'workbench.preference.model',
  'workbench.preference.workspace-id'
] as const

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  artifact: '产物',
  preview: '预览',
  source: '源文件'
}
