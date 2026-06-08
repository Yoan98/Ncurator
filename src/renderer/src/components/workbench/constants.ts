import type { WorkbenchFileOrigin } from './types'
import type { AiFileChangeStatus } from '../../../../shared/types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed'
export const WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY = 'workbench.content-panel.collapsed'
export const WORKBENCH_PREFERENCE_MODE_STORAGE_KEY = 'workbench.preference.mode'
export const WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY = 'workbench.preference.model'
export const WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY = 'workbench.preference.workspace-id'

export const FILE_CHANGE_STATUS_META: Record<AiFileChangeStatus, { label: string; className: string }> =
  {
    applied: { label: '已修改', className: 'border-[#E1DED6] bg-[#F0EFEB] text-[#181818]' },
    reverted: { label: '已回退', className: 'border-[#CBC7BD] bg-[#FAF9F5] text-[#6E6D69]' },
    failed: { label: '失败', className: 'border-[#D9C6C2] bg-[#F7F1EF] text-[#A83A31]' }
  }

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  artifact: '产物',
  preview: '预览',
  source: '源文件'
}
