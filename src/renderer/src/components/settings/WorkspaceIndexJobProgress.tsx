import React from 'react'
import { Progress } from 'antd'
import type { WorkspaceIndexJobRecord } from '../../../../shared/types'
import { getIndexJobProgressNumbers } from '../../../../shared/indexJobProgress'

type WorkspaceIndexJobProgressProps = {
  job?: WorkspaceIndexJobRecord
  testId: string
}

const getJobTitle = (job: WorkspaceIndexJobRecord): string => {
  if (job.source_kind === 'file' && job.action === 'scan') {
    if (job.phase === 'scan') return '步骤 1/2 扫描工作目录'
    if (job.phase === 'diff') return '步骤 2/2 比对文件索引'
  }
  if (job.source_kind === 'web' && job.action === 'prepare') {
    if (job.phase === 'crawl') return '抓取网页'
    if (job.phase === 'index') return '建立索引'
  }
  if (job.action === 'scan') return job.source_kind === 'web' ? '检查网页更新' : '检查文件更新'
  return job.source_kind === 'web' ? '更新网页索引' : '更新文件索引'
}

const WorkspaceIndexJobProgress: React.FC<WorkspaceIndexJobProgressProps> = ({ job, testId }) => {
  if (!job || job.status !== 'running') return null
  const title = getJobTitle(job)
  const progress = getIndexJobProgressNumbers(job)
  const message = job.message || '正在处理'
  const shouldHideMessage = message === title

  return (
    <div
      className="mt-3 rounded-[6px] border border-[#EEEEEC] bg-white px-3 py-2"
      data-testid={testId}
    >
      <div className="flex items-center text-[12px]">
        <span className="font-medium text-[#37352F]">{title}</span>
      </div>
      <Progress
        percent={progress.hasDeterminateProgress ? progress.percent : 0}
        status={!progress.hasDeterminateProgress || progress.percent > 0 ? 'active' : 'normal'}
        showInfo={false}
        size="small"
        strokeColor="#37352F"
        trailColor="#E8E6E3"
        className="mt-1.5"
      />
      {shouldHideMessage ? null : (
        <div className="mt-1 text-[11px] text-[#787774]">
          <span className="block truncate">{message}</span>
        </div>
      )}
    </div>
  )
}

export default WorkspaceIndexJobProgress
