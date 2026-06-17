import type { WorkbenchFileOrigin } from './types'
import type { AiFileChangeStatus } from '../../../../shared/types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed'
export const WORKBENCH_SIDEBAR_WIDTH_STORAGE_KEY = 'workbench.sidebar.width'
export const WORKBENCH_SIDEBAR_DEFAULT_WIDTH = 240
export const WORKBENCH_SIDEBAR_MIN_WIDTH = 220
export const WORKBENCH_SIDEBAR_MAX_WIDTH = 320
export const WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY = 'workbench.content-panel.collapsed'
export const WORKBENCH_PREFERENCE_MODE_STORAGE_KEY = 'workbench.preference.mode'
export const WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY = 'workbench.preference.model'
export const WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY = 'workbench.preference.workspace-id'

export const FILE_CHANGE_STATUS_META: Record<AiFileChangeStatus, { label: string; className: string }> =
  {
    applied: { label: '已修改', className: 'border-[#EEEEEC] bg-[#F4F4F2] text-[#37352F]' },
    reverted: { label: '已回退', className: 'border-[#E0DFDC] bg-[#F7F7F5] text-[#787774]' },
    failed: { label: '失败', className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]' }
  }

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  artifact: '产物',
  preview: '预览',
  source: '源文件'
}
