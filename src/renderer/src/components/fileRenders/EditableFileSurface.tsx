import React from 'react'
import { Button, Tooltip } from 'antd'
import { HiCheckCircle } from 'react-icons/hi2'
import { workbenchSelectors } from '../../testing/selectors'
import type { EditableTextFile } from './useEditableTextFile'

type EditableFileSurfaceProps = {
  file: EditableTextFile
  saveDisabled?: boolean
  onSave: () => void
  onForceSave: () => void
  onReload: () => void
  children: React.ReactNode
}

export const EditableFileSurface: React.FC<EditableFileSurfaceProps> = ({
  file,
  saveDisabled = false,
  onSave,
  onForceSave,
  onReload,
  children
}) => {
  const saveAvailable = !file.saving && (!saveDisabled || file.externalConflict)

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div
        className="flex h-10 shrink-0 items-center gap-2 border-b border-[#EEEEEC] bg-white px-3"
        data-testid={workbenchSelectors.editableFileToolbar}
      >
        <div className="min-w-0 flex-1" />
        {file.dirty ? (
          <span
            className="inline-flex h-5 shrink-0 items-center rounded-[4px] bg-[#FBF3DB] px-1.5 text-[11px] font-medium text-[#7A4D00]"
            data-testid={workbenchSelectors.editableFileDirtyBadge}
          >
            未保存
          </span>
        ) : null}
        <Tooltip title="保存（Cmd/Ctrl + S）">
          <Button
            type="text"
            size="small"
            aria-label="保存"
            loading={file.saving}
            disabled={!saveAvailable}
            icon={<HiCheckCircle className="h-4 w-4" />}
            className="!text-[#37352F] hover:!bg-[#F4F4F2] disabled:!text-[#C9C7C2]"
            data-testid={workbenchSelectors.editableFileSaveButton}
            onClick={onSave}
          >
            保存
          </Button>
        </Tooltip>
      </div>
      {file.externalConflict ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-[#F0D9D6] bg-[#F8EBE9] px-3 py-2"
          data-testid={workbenchSelectors.editableFileConflictBanner}
        >
          <span className="min-w-0 flex-1 text-xs text-[#B3261E]">
            文件已被外部修改，保存会覆盖外部内容。
          </span>
          <Button
            type="text"
            size="small"
            className="!text-[#B3261E] hover:!bg-[#F0D9D6]"
            data-testid={workbenchSelectors.editableFileConflictSave}
            onClick={onForceSave}
          >
            仍然保存
          </Button>
          <Button
            type="text"
            size="small"
            className="!text-[#37352F] hover:!bg-[#F4F4F2]"
            data-testid={workbenchSelectors.editableFileConflictReload}
            onClick={onReload}
          >
            重新加载
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
