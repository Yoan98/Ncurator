import type { AssistantStepStatus, WorkbenchFileOrigin } from './types'
import type { DraftReviewStatus } from '../../../../shared/types'

export const WORKBENCH_SIDEBAR_STORAGE_KEY = 'workbench.sidebar.collapsed'

export const ASSISTANT_STEP_STATUS_META: Record<
  AssistantStepStatus,
  { label: string; className: string }
> = {
  running: { label: '进行中', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#8A6510]' },
  completed: { label: '已完成', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' },
  review_needed: { label: '待确认', className: 'border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]' },
  failed: { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}

export const REVIEW_STATUS_META: Record<
  DraftReviewStatus,
  { label: string; className: string }
> = {
  review_pending: { label: '待确认修改', className: 'border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]' },
  commit_ready: { label: '可提交', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' },
  committing: { label: '提交中', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#8A6510]' },
  committed: { label: '已提交', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' },
  conflicted: { label: '有冲突', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' },
  cancelled: { label: '已取消', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' },
  failed: { label: '提交失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}

export const FILE_ORIGIN_LABELS: Record<WorkbenchFileOrigin, string> = {
  search_hit: '搜索命中',
  read: '读取',
  edited_draft: '待确认修改',
  artifact: '产物',
  preview: '预览'
}
