import React, { useCallback, useEffect, useState } from 'react'
import { Empty, Spin, message } from 'antd'
import { useEditableTextFile } from './useEditableTextFile'
import { registerEditableFileDirty } from './editableDirtyRegistry'
import { EditableFileSurface } from './EditableFileSurface'
import { workbenchSelectors } from '../../testing/selectors'

const TEXT_EDIT_MAX_CHARS = 500_000

const PlainTextEditor: React.FC<{ filePath: string }> = ({ filePath }) => {
  const file = useEditableTextFile(filePath)
  const [value, setValue] = useState('')
  const { initialText, setDirty } = file

  useEffect(() => {
    if (file.initialText !== null) setValue(file.initialText)
  }, [file.initialText])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const next = event.target.value
      setValue(next)
      setDirty(next !== (initialText ?? ''))
    },
    [initialText, setDirty]
  )

  const saveContent = useCallback(
    async (options?: { force?: boolean }): Promise<void> => {
      const result = await file.save(value, options)
      if (result.ok) {
        message.success('已保存')
      } else if (result.conflict) {
        message.warning(result.error || '文件已被外部修改')
      } else {
        message.error(result.error || '保存失败')
      }
    },
    [file, value]
  )

  const handleSave = useCallback((): void => {
    void saveContent()
  }, [saveContent])

  const handleForceSave = useCallback((): void => {
    void saveContent({ force: true })
  }, [saveContent])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  useEffect(() => {
    registerEditableFileDirty(filePath, file.dirty)
    return () => registerEditableFileDirty(filePath, false)
  }, [filePath, file.dirty])

  if (file.loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Spin />
      </div>
    )
  }

  if (file.loadError || file.initialText === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={file.loadError || '文件加载失败'} />
      </div>
    )
  }

  const truncated = file.initialText.length > TEXT_EDIT_MAX_CHARS

  return (
    <EditableFileSurface
      file={file}
      saveDisabled={!file.dirty}
      onSave={handleSave}
      onForceSave={handleForceSave}
      onReload={() => void file.reload()}
    >
      <div className="flex h-full w-full flex-col overflow-hidden bg-white">
        {truncated ? (
          <div className="shrink-0 border-b border-[#EEEEEC] bg-[#FFF8E5] px-6 py-2 text-xs text-[#7A4D00]">
            文件较大，仅可编辑前 {TEXT_EDIT_MAX_CHARS.toLocaleString()} 个字符。
          </div>
        ) : null}
        <textarea
          className="m-0 min-h-0 flex-1 resize-none whitespace-pre-wrap break-words border-0 bg-white px-8 py-6 font-mono text-[13px] leading-6 text-[#37352F] outline-none"
          data-testid={workbenchSelectors.plainTextEditor}
          value={truncated ? value.slice(0, TEXT_EDIT_MAX_CHARS) : value}
          onChange={handleChange}
          spellCheck={false}
        />
      </div>
    </EditableFileSurface>
  )
}

export default React.memo(PlainTextEditor)
