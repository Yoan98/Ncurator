import React, { useMemo } from 'react'
import { Button, Spin, Tooltip } from 'antd'
import { HiArrowPath, HiArrowTopRightOnSquare, HiFolderOpen } from 'react-icons/hi2'
import type { DocxApplyRecord } from '../../../../shared/types'
import { FileRenderViewer } from '../fileRenders'
import type { FileChangeWorkspaceTab } from './types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchApplyPanelProps = {
  record: DocxApplyRecord | null
  activeFileKey: string | null
  loading: boolean
  reverting: boolean
  tabs: FileChangeWorkspaceTab[]
  onSelectTab: (fileKey: string) => void
  onRevert: () => void
  onOpenPath: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchApplyPanel: React.FC<WorkbenchApplyPanelProps> = ({
  record,
  activeFileKey,
  loading,
  reverting,
  tabs,
  onSelectTab,
  onRevert,
  onOpenPath,
  onRevealPath
}) => {
  const canRevert = Boolean(record && record.status === 'applied' && !reverting)
  const hasDedicatedPreview = Boolean(record?.preview_diff_checksum)

  const viewerDocuments = useMemo(
    () =>
      record?.preview_diff_artifact_path && record.source_name
        ? [
            {
              filePath: record.preview_diff_artifact_path,
              fileName: record.source_name
            }
          ]
        : [],
    [record?.preview_diff_artifact_path, record?.source_name]
  )

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid={workbenchSelectors.applyPanel}
      >
        <Spin />
      </div>
    )
  }

  if (!record) {
    return (
      <div
        className="ui-inset flex h-full items-center justify-center border-dashed text-sm text-[#9B9A97]"
        data-testid={workbenchSelectors.applyPanel}
      >
        当前没有 AI 修改记录。
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={workbenchSelectors.applyPanel}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[#EEEEEC] bg-white px-4 py-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          data-testid={workbenchSelectors.applyTabs}
        >
          {tabs.map((tab) => {
            const active = tab.fileKey === activeFileKey
            return (
              <button
                key={tab.fileKey}
                type="button"
                onClick={() => onSelectTab(tab.fileKey)}
                className={`relative flex h-9 shrink-0 items-center gap-2 border-b-2 px-2 text-sm transition-colors ${
                  active
                    ? 'border-[#37352F] font-semibold text-[#37352F]'
                    : 'border-transparent font-medium text-[#787774] hover:text-[#37352F]'
                }`}
              >
                <span className="max-w-[220px] truncate">{tab.fileName}</span>
                {tab.unseen ? (
                  <span className="absolute right-0 top-1 h-1.5 w-1.5 rounded-full bg-[#37352F]" />
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip title="系统打开">
            <Button
              type="text"
              size="small"
              aria-label="系统打开"
              icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
              className="!flex !h-8 !w-8 !items-center !justify-center !rounded-[6px] !p-0 !text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F]"
              data-testid={workbenchSelectors.applyOpenSystemButton}
              onClick={() => void onOpenPath(record.source_path)}
            />
          </Tooltip>
          <Tooltip title="定位">
            <Button
              type="text"
              size="small"
              aria-label="定位"
              icon={<HiFolderOpen className="h-4 w-4" />}
              className="!flex !h-8 !w-8 !items-center !justify-center !rounded-[6px] !p-0 !text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F]"
              data-testid={workbenchSelectors.applyRevealButton}
              onClick={() => void onRevealPath(record.source_path)}
            />
          </Tooltip>
          <Tooltip title="回退本次修改">
            <Button
              type="text"
              size="small"
              aria-label="回退本次修改"
              icon={<HiArrowPath className="h-4 w-4" />}
              className="!flex !h-8 !w-8 !items-center !justify-center !rounded-[6px] !p-0 !text-[#787774] hover:!bg-[#F4F4F2] hover:!text-[#37352F] disabled:!text-[#C9C7C2]"
              onClick={onRevert}
              loading={reverting}
              disabled={!canRevert}
              data-testid={workbenchSelectors.applyRevertButton}
            />
          </Tooltip>
        </div>
      </div>

      {record.status === 'reverted' ? (
        <div className="shrink-0 border-b border-[#EEEEEC] bg-white px-4 py-2.5 text-xs text-[#787774]">
          本次 AI 修改已回退。
        </div>
      ) : null}

      {record.status === 'failed' && record.error ? (
        <div className="shrink-0 border-b border-[#E7CAC6] bg-white px-4 py-2.5 text-xs text-[#B3261E]">
          {record.error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-white p-3">
        <FileRenderViewer
          documents={viewerDocuments}
          emptyText={
            hasDedicatedPreview ? '当前文件暂时不可预览。' : '当前修改记录没有专用预览稿。'
          }
        />
      </div>
    </div>
  )
}

export default WorkbenchApplyPanel
