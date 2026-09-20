import type { WebSourceRecord, WorkspaceIndexJobRecord } from '../../../../../shared/types'

export const WEB_INDEX_TERMINAL_STATUSES = ['indexed', 'crawl_failed', 'index_failed'] as const
export const WEB_INDEX_PENDING_STATUSES = [
  'needs_index',
  'crawl_failed',
  'index_failed',
  'crawling',
  'indexing'
] as const

export const getFileIndexCancelPreview = (input: {
  runningJob?: WorkspaceIndexJobRecord
  sessionCompleted: number
  unstartedActionableCount: number
}): { completed: number; remaining: number } => {
  const processed = Math.max(0, input.runningJob?.processed_count || 0)
  const total = Math.max(0, input.runningJob?.total_count || 0)
  return {
    completed: Math.max(0, input.sessionCompleted) + processed,
    remaining: Math.max(0, total - processed) + Math.max(0, input.unstartedActionableCount)
  }
}

export const getWebIndexCancelPreview = (input: {
  job?: WorkspaceIndexJobRecord
  sources: WebSourceRecord[]
}): { completed: number; remaining: number } => {
  const targetIds = input.job?.target_ids || []
  const targets =
    targetIds.length > 0
      ? input.sources.filter((source) => targetIds.includes(source.id))
      : input.sources.filter((source) =>
          (WEB_INDEX_PENDING_STATUSES as readonly string[]).includes(source.index_status)
        )
  const completed = targets.filter((source) =>
    (WEB_INDEX_TERMINAL_STATUSES as readonly string[]).includes(source.index_status)
  ).length
  return {
    completed,
    remaining: Math.max(0, targets.length - completed)
  }
}

export const formatIndexCancelContent = (
  kind: 'file' | 'web',
  completed: number,
  remaining: number
): string => {
  const unit = kind === 'web' ? '网页' : '文件'
  return `已完成 ${completed} 个${unit}。剩余 ${remaining} 个${unit}将停止，不会完成本次索引。已经完成的索引会保留。`
}
