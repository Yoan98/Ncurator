import { localizeSystemText } from '../../i18n/systemText'
import { t } from '../../i18n'
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
    if (job.phase === 'scan') return t(($) => $.settings.step12ScanWorkspaceDirectories)
    if (job.phase === 'diff') return t(($) => $.settings.step22CompareFileIndexes)
  }
  if (job.source_kind === 'web' && job.action === 'prepare') {
    if (job.phase === 'crawl') return t(($) => $.settings.fetchWebpage)
    if (job.phase === 'index') return t(($) => $.settings.buildIndex)
  }
  if (job.action === 'scan')
    return job.source_kind === 'web'
      ? t(($) => $.settings.checkWebpageUpdates)
      : t(($) => $.settings.checkFileUpdates)
  return job.source_kind === 'web'
    ? t(($) => $.settings.updateWebpageIndex)
    : t(($) => $.settings.updateFileIndex)
}

const WorkspaceIndexJobProgress: React.FC<WorkspaceIndexJobProgressProps> = ({ job, testId }) => {
  if (!job || job.status !== 'running') return null
  const title = getJobTitle(job)
  const progress = getIndexJobProgressNumbers(job)
  const message = localizeSystemText(job.message || t(($) => $.settings.processing))
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
