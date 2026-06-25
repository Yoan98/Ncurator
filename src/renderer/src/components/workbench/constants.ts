import type { WorkbenchFileOrigin } from './types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed.v2'
export const WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY = 'workbench.sidebar.width'
export const WORKBENCH_SIDEBAR_DEFAULT_WIDTH = 240
export const WORKBENCH_SIDEBAR_MIN_WIDTH = 220
export const WORKBENCH_SIDEBAR_MAX_WIDTH = 320
export const WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH = 170
export const WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY = 'workbench.content-panel.collapsed.v2'
export const WORKBENCH_PREFERENCE_MODE_STORAGE_KEY = 'workbench.preference.mode'
export const WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY = 'workbench.preference.model'
export const WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY = 'workbench.preference.workspace-id'

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  artifact: '产物',
  preview: '预览',
  source: '源文件'
}
