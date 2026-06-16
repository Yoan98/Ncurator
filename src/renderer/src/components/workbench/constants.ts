import type { WorkbenchFileOrigin } from './types'
import type { AiFileChangeStatus } from '../../../../shared/types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed'
export const WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY = 'workbench.content-panel.collapsed'
export const WORKBENCH_PREFERENCE_MODE_STORAGE_KEY = 'workbench.preference.mode'
export const WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY = 'workbench.preference.model'
export const WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY = 'workbench.preference.workspace-id'

export const FILE_CHANGE_STATUS_META: Record<AiFileChangeStatus, { label: string; className: string }> =
  {
    applied: { label: '已修改', className: 'border-[#E6E4DF] bg-[#F2F1EE] text-[#37352F]' },
    reverted: { label: '已回退', className: 'border-[#D8D6D0] bg-[#F7F7F5] text-[#5F5E59]' },
    failed: { label: '失败', className: 'border-[#E7CAC6] bg-[#F8EBE9] text-[#B3261E]' }
  }

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  artifact: '产物',
  preview: '预览',
  source: '源文件'
}
