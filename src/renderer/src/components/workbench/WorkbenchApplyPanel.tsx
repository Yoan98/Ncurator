import React, { useMemo } from 'react'
import { Button, Spin } from 'antd'
import type { DocxApplyRecord } from '../../../../shared/types'
import { FileRenderViewer } from '../fileRenders'
import { DOCX_APPLY_STATUS_META } from './constants'
import type { DocxApplyWorkspaceTab } from './types'
import { workbenchSelectors } from '../../testing/selectors'

type WorkbenchApplyPanelProps = {
  record: DocxApplyRecord | null
  loading: boolean
  reverting: boolean
  tabs: DocxApplyWorkspaceTab[]
  onSelectTab: (fileKey: string) => void
  onRevert: () => void
  onOpenPath: (filePath: string) => Promise<void>
  onOpenWithApplication: (filePath: string) => Promise<void>
  onRevealPath: (filePath: string) => Promise<void>
}

const WorkbenchApplyPanel: React.FC<WorkbenchApplyPanelProps> = ({
  record,
  loading,
  reverting,
  tabs,
  onSelectTab,
  onRevert,
  onOpenPath,
  onOpenWithApplication,
  onRevealPath
}) => {
  const statusMeta = record ? DOCX_APPLY_STATUS_META[record.status] : null
  const canRevert = Boolean(record && record.status === 'applied' && !reverting)

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
        className="ui-inset flex h-full items-center justify-center border-dashed text-sm text-[#999999]"
        data-testid={workbenchSelectors.applyPanel}
      >
        当前没有 AI 修改记录。
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={workbenchSelectors.applyPanel}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[#E5E5E4] bg-[#FCFBF8] px-4 py-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
          data-testid={workbenchSelectors.applyTabs}
        >
          {tabs.map((tab) => {
            const active = tab.fileKey === record.source_path
            return (
              <button
                key={tab.fileKey}
                type="button"
                onClick={() => onSelectTab(tab.fileKey)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-[#D97757] bg-white text-[#D97757]'
                    : 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666] hover:border-[#D97757] hover:text-[#D97757]'
                }`}
              >
                <span className="max-w-[180px] truncate">{tab.fileName}</span>
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px]">
                  {tab.changeCount}
                </span>
                {tab.unseen ? <span className="h-1.5 w-1.5 rounded-full bg-[#D97757]" /> : null}
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
          <span className="text-xs text-[#666666]">{record.change_count} 处修改</span>
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
        <div className="shrink-0 border-b border-[#E5E5E4] bg-[#F8F8F7] px-4 py-2.5 text-xs text-[#666666]">
          本次 AI 修改已回退。
        </div>
      ) : null}

      {record.status === 'failed' && record.error ? (
        <div className="shrink-0 border-b border-[#F7D5D9] bg-[#FFF2F4] px-4 py-2.5 text-xs text-[#B5455D]">
          {record.error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-[#F5F3EE] p-3">
        <FileRenderViewer documents={viewerDocuments} emptyText="当前文件暂时不可预览。" />
      </div>
    </div>
  )
}

export default WorkbenchApplyPanel
