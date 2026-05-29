import type { AssistantStepStatus, WorkbenchFileOrigin } from './types'
import type { DocxApplyStatus } from '../../../../shared/types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed'
export const WORKBENCH_CONTENT_PANEL_COLLAPSED_STORAGE_KEY = 'workbench.content-panel.collapsed'

export const ASSISTANT_STEP_STATUS_META: Record<
  AssistantStepStatus,
  { label: string; className: string }
> = {
  running: { label: '进行中', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#8A6510]' },
  completed: { label: '已完成', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' },
  review_needed: { label: '已修改', className: 'border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]' },
  failed: { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}

export const DOCX_APPLY_STATUS_META: Record<DocxApplyStatus, { label: string; className: string }> = {
  applied: { label: '已修改', className: 'border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]' },
  reverted: { label: '已回退', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' },
  failed: { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  edited_file: '已修改',
  artifact: '产物',
  preview: '预览',
  source: '源文件'
}
