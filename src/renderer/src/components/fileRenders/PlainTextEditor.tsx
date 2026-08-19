import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { useEditableTextFile } from './useEditableTextFile'
import { workbenchSelectors } from '../../testing/selectors'
import LineNumberOverlay from './LineNumberOverlay'
import { countLines } from './lineNumbers'

const TEXT_EDIT_MAX_CHARS = 500_000

const PlainTextEditor: React.FC<{ filePath: string }> = ({ filePath }) => {
  const file = useEditableTextFile(filePath)
  const [value, setValue] = useState('')
  const { initialText, autoSave, flushSave } = file
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterInnerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (initialText !== null) setValue(initialText)
  }, [initialText])

  const syncGutter = useCallback((): void => {
    const textarea = textareaRef.current
    const gutter = gutterInnerRef.current
    if (textarea && gutter) {
      gutter.style.transform = `translateY(${-textarea.scrollTop}px)`
    }
  }, [])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const next = event.target.value
      setValue(next)
      autoSave(next)
    },
    [autoSave]
  )

  useEffect(() => {
    syncGutter()
  }, [value, syncGutter])

  useEffect(() => {
    const editor = textareaRef.current
    if (!editor) return
    const onBlur = (): void => flushSave()
    editor.addEventListener('blur', onBlur)
    return () => editor.removeEventListener('blur', onBlur)
  }, [flushSave, file.loading])

  useEffect(
    () => () => {
      flushSave()
    },
    [flushSave]
  )

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
  const displayValue = truncated ? value.slice(0, TEXT_EDIT_MAX_CHARS) : value
  const lineCount = countLines(displayValue)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      {truncated ? (
        <div className="shrink-0 border-b border-[#EEEEEC] bg-[#FFF8E5] px-6 py-2 text-xs text-[#7A4D00]">
          文件较大，仅可编辑前 {TEXT_EDIT_MAX_CHARS.toLocaleString()} 个字符。
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <LineNumberOverlay
          lineCount={lineCount}
          innerRef={gutterInnerRef}
          className="inset-y-0 left-0 w-8 overflow-hidden"
          testId={workbenchSelectors.lineNumberOverlay}
        />
        <textarea
          ref={textareaRef}
          className="m-0 h-full w-full resize-none whitespace-pre-wrap break-words border-0 bg-white px-8 py-6 font-mono text-[13px] leading-6 text-[#37352F] outline-none"
          data-testid={workbenchSelectors.plainTextEditor}
          value={displayValue}
          onChange={handleChange}
          onScroll={syncGutter}
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export default React.memo(PlainTextEditor)
