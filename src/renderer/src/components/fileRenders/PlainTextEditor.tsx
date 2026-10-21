import { t, getRendererRuntime } from '../../i18n'
import { useContext, useMemo } from 'react'
import { DocumentSelectionContext } from '../workbench/composer/DocumentSelectionContext'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { plainTextAdapter } from './selection/textFileAdapter'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import { useEditableTextFile } from './useEditableTextFile'
import { workbenchSelectors } from '../../testing/selectors'
import LineNumberOverlay from './LineNumberOverlay'
import { countLines } from './lineNumbers'

const TEXT_EDIT_MAX_CHARS = 500_000

const PlainTextEditor: React.FC<{ filePath: string; allowSelection?: boolean }> = ({
  filePath,
  allowSelection = false
}) => {
  const file = useEditableTextFile(filePath)
  const [value, setValue] = useState('')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [mirror, setMirror] = useState<HTMLPreElement | null>(null)
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null)
  const selectionState = useContext(DocumentSelectionContext)
  const adapter = useMemo(
    () => (textarea && mirror ? plainTextAdapter(textarea, mirror, filePath) : null),
    [textarea, mirror, filePath]
  )
  const { initialText, autoSave, flushSave } = file
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const bindTextarea = useCallback((element: HTMLTextAreaElement | null) => {
    textareaRef.current = element
    setTextarea(element)
  }, [])
  const gutterInnerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (initialText !== null) setValue(initialText)
  }, [initialText])

  const syncGutter = useCallback((): void => {
    const textarea = textareaRef.current
    const gutter = gutterInnerRef.current
    if (textarea && gutter) {
      if (mirror) {
        mirror.scrollTo({ top: textarea.scrollTop, left: textarea.scrollLeft })
      }
      gutter.style.transform = `translateY(${-textarea.scrollTop}px)`
    }
  }, [mirror])

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
    const onBlur = (): void =>
      void flushSave().catch((error) =>
        console.error(
          t(($) => $.editors.couldNotSaveTheFile),
          error
        )
      )
    editor.addEventListener('blur', onBlur)
    return () => editor.removeEventListener('blur', onBlur)
  }, [flushSave, file.loading])

  useEffect(
    () => () => {
      void flushSave().catch((error) =>
        console.error(
          t(($) => $.editors.couldNotSaveTheFile),
          error
        )
      )
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
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={file.loadError || t(($) => $.editors.couldNotLoadTheFile)}
        />
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
          {t(($) => $.editors.thisFileIsLargeEditingIsLimitedToThe)}
          {TEXT_EDIT_MAX_CHARS.toLocaleString(getRendererRuntime().locale)}
          {t(($) => $.editors.characters)}
        </div>
      ) : null}
      <div ref={setContainer} className="relative min-h-0 flex-1">
        <LineNumberOverlay
          lineCount={lineCount}
          innerRef={gutterInnerRef}
          className="inset-y-0 left-0 w-8 overflow-hidden"
          testId={workbenchSelectors.lineNumberOverlay}
        />
        <pre
          ref={setMirror}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 m-0 overflow-hidden whitespace-pre-wrap break-words px-8 py-6 font-mono text-[13px] leading-6 text-transparent"
          style={{ overflowWrap: 'break-word' }}
        >
          {displayValue}
        </pre>
        <textarea
          ref={bindTextarea}
          readOnly={file.readOnly || Boolean(selectionState?.locked)}
          className="relative z-[1] m-0 h-full w-full resize-none whitespace-pre-wrap break-words border-0 bg-transparent px-8 py-6 font-mono text-[13px] leading-6 text-[#37352F] outline-none"
          data-testid={workbenchSelectors.plainTextEditor}
          value={displayValue}
          onChange={handleChange}
          onScroll={syncGutter}
          spellCheck={false}
        />
        {allowSelection && adapter && (
          <DocumentSelectionLayer
            container={container}
            filePath={filePath}
            revision={1}
            adapter={adapter}
            testPrefix="text"
          />
        )}
      </div>
    </div>
  )
}

export default React.memo(PlainTextEditor)
