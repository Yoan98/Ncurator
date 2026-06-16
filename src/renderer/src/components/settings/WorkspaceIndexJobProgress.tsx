import React from 'react'
import { Progress } from 'antd'
import type { WorkspaceIndexJobRecord } from '../../../../shared/types'

type WorkspaceIndexJobProgressProps = {
  job?: WorkspaceIndexJobRecord
  testId: string
}

const getJobTitle = (job: WorkspaceIndexJobRecord): string => {
  if (job.source_kind === 'web' && job.action === 'prepare') {
    if (job.phase === 'crawl') return '步骤 1/2 抓取网页'
    if (job.phase === 'index') return '步骤 2/2 建立索引'
  }
  if (job.action === 'scan') return job.source_kind === 'web' ? '检查网页更新' : '检查文件更新'
  return job.source_kind === 'web' ? '更新网页索引' : '更新文件索引'
}

const WorkspaceIndexJobProgress: React.FC<WorkspaceIndexJobProgressProps> = ({ job, testId }) => {
  if (!job || job.status !== 'running') return null
  const title = getJobTitle(job)
  const total = Math.max(0, job.total_count)
  const done = Math.min(total, Math.max(0, job.processed_count + job.failed_count))
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const message = job.message || '正在处理'
  const shouldHideMessage = message.startsWith(`${title}：`) || message === title

  return (
    <div
      className="mt-3 rounded-[6px] border border-[#E6E4DF] bg-white px-3 py-2"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-[#37352F]">{title}</span>
        <span className="shrink-0 text-[#9B9A97]">{percent}%</span>
      </div>
      <Progress
        percent={percent}
        showInfo={false}
        size="small"
        strokeColor="#37352F"
        trailColor="#F1EFEC"
        className="mt-1.5"
      />
      {shouldHideMessage ? null : (
        <div className="mt-1 text-[11px] text-[#5F5E59]">
          <span className="block truncate">{message}</span>
        </div>
      )}
    </div>
  )
}

export default WorkspaceIndexJobProgress
