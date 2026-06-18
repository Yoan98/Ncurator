import React, { useMemo } from 'react'
import { Button, Spin } from 'antd'
import type { DocxApplyRecord } from '../../../../shared/types'
import { FileRenderViewer } from '../fileRenders'
import { FILE_CHANGE_STATUS_META } from './constants'
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
  onOpenWithApplication: (filePath: string) => Promise<void>
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
  onOpenWithApplication,
  onRevealPath
}) => {
  const statusMeta = record ? FILE_CHANGE_STATUS_META[record.status] : null
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
    [record]
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
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
          data-testid={workbenchSelectors.applyTabs}
        >
          {tabs.map((tab) => {
            const active = tab.fileKey === activeFileKey
            return (
              <button
                key={tab.fileKey}
                type="button"
                onClick={() => onSelectTab(tab.fileKey)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-[#37352F] bg-white text-[#37352F]'
                    : 'border-[#EEEEEC] bg-[#F7F7F5] text-[#787774] hover:border-[#37352F] hover:text-[#37352F]'
                }`}
              >
                <span className="max-w-[180px] truncate">{tab.fileName}</span>
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px]">
                  {tab.changeCount}
                </span>
                {tab.unseen ? <span className="h-1.5 w-1.5 rounded-full bg-[#37352F]" /> : null}
              </button>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {statusMeta ? (
            <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusMeta.className}`}>
              {statusMeta.label}
            </span>
          ) : null}
          <span className="text-xs text-[#9B9A97]">{record.change_count} 处修改</span>
          <Button size="small" onClick={() => void onOpenPath(record.source_path)}>
            系统打开
          </Button>
          <Button size="small" onClick={() => void onOpenWithApplication(record.source_path)}>
            其他应用
          </Button>
          <Button size="small" onClick={() => void onRevealPath(record.source_path)}>
            定位
          </Button>
          <Button
            type="primary"
            size="small"
            onClick={onRevert}
            loading={reverting}
            disabled={!canRevert}
            data-testid={workbenchSelectors.applyRevertButton}
          >
            回退本次修改
          </Button>
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
          emptyText={hasDedicatedPreview ? '当前文件暂时不可预览。' : '当前修改记录没有专用预览稿。'}
        />
      </div>
    </div>
  )
}

export default WorkbenchApplyPanel
