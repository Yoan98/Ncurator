import React, { useEffect, useRef } from 'react'
import { Empty, Spin } from 'antd'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './markdownEditor.css'
import { useEditableTextFile } from './useEditableTextFile'
import { workbenchSelectors } from '../../testing/selectors'

const resolveVditorCdn = (): string => new URL('vditor', document.baseURI).href

const MarkdownEditor: React.FC<{ filePath: string }> = ({ filePath }) => {
  const file = useEditableTextFile(filePath)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const readyRef = useRef(false)
  const { initialText, autoSave, flushSave } = file

  useEffect(() => {
    if (initialText === null || !rootRef.current || vditorRef.current) return
    readyRef.current = false
    const vditor = new Vditor(rootRef.current, {
      mode: 'ir',
      lang: 'zh_CN',
      toolbar: [],
      cache: { enable: false },
      value: initialText,
      cdn: resolveVditorCdn(),
      placeholder: '开始输入…',
      link: { isOpen: false },
      preview: {
        delay: 80,
        hljs: { enable: true, lineNumber: false, style: 'a11y-light' },
        math: { engine: 'KaTeX' },
        markdown: { gfmAutoLink: true, footnotes: true }
      },
      input: (value) => autoSave(value),
      after: () => {
        readyRef.current = true
      }
    })
    vditorRef.current = vditor
  }, [initialText, autoSave])

  useEffect(() => {
    if (!readyRef.current || !vditorRef.current) return
    const current = vditorRef.current
    if (current.getValue() === initialText) return
    current.setValue(initialText ?? '')
  }, [initialText])

  useEffect(
    () => () => {
      flushSave()
      const vditor = vditorRef.current
      vditorRef.current = null
      if (!vditor || !readyRef.current) return
      try {
        vditor.destroy()
      } catch (error) {
        console.error('[APP-ERROR] vditor destroy failed', error)
      }
      readyRef.current = false
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

  return (
    <div
      ref={rootRef}
      className="h-full w-full overflow-hidden bg-white"
      data-testid={workbenchSelectors.markdownEditor}
    />
  )
}

export default React.memo(MarkdownEditor)
