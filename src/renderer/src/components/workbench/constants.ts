import type { WorkbenchFileOrigin } from './types'
import {
  WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO,
  WORKBENCH_CONTENT_PANEL_MAX_RATIO,
  WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH,
  WORKBENCH_CONTENT_PANEL_MIN_WIDTH,
  clampWorkbenchContentPanelRatio,
  resolveWorkbenchContentPanelWidth
} from '../../../../shared/workbench/contentPanelWidth'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed.v2'
export const WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY = 'workbench.sidebar.width'
export const WORKBENCH_SIDEBAR_DEFAULT_WIDTH = 240
export const WORKBENCH_SIDEBAR_MIN_WIDTH = 220
export const WORKBENCH_SIDEBAR_MAX_WIDTH = 320
export const WORKBENCH_LEFT_TITLEBAR_COLLAPSED_WIDTH = 170
export const WORKBENCH_TITLEBAR_HEIGHT = 44

/** 右侧内容面板占「中间+右侧」主区宽度的比例（不含左侧栏） */
export const WORKBENCH_CONTENT_PANEL_RATIO_STORAGE_KEY = 'workbench.content-panel.ratio'
export {
  WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO,
  WORKBENCH_CONTENT_PANEL_MAX_RATIO,
  WORKBENCH_CONTENT_PANEL_MIN_WIDTH,
  WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH,
  clampWorkbenchContentPanelRatio,
  resolveWorkbenchContentPanelWidth
}
/** 拖过该宽度立即吸合折叠 */
export const WORKBENCH_CONTENT_PANEL_COLLAPSE_WIDTH = 200

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
