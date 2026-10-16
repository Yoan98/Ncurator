import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Spin } from 'antd'
import type { AiFileChangeRecord } from '../../../../shared/types'
import { useEditableTextFile } from '../fileRenders/useEditableTextFile'
import { workbenchSelectors } from '../../testing/selectors'
import { monaco } from './monacoReview'

type Counts = { insertCount: number; deleteCount: number }
export function TextFileDiffViewer({
  record,
  onCountsChange
}: {
  record: AiFileChangeRecord
  onCountsChange: (counts: Counts) => void
}) {
  const file = useEditableTextFile(record.path)
  const [before, setBefore] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [fold, setFold] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const original = useRef<monaco.editor.ITextModel | null>(null)
  const modified = useRef<monaco.editor.ITextModel | null>(null)
  const suppressChange = useRef(false)
  const modifiedEditor = useRef<monaco.editor.ICodeEditor | null>(null)
  const rightViewState = useRef<monaco.editor.ICodeEditorViewState | null>(null)
  const diff = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const fileRef = useRef(file)
  const countsRef = useRef(onCountsChange)
  const foldRef = useRef(fold)
  useLayoutEffect(() => {
    fileRef.current = file
    countsRef.current = onCountsChange
    foldRef.current = fold
  }, [file, onCountsChange, fold])
  useEffect(() => {
    let cancelled = false
    setBefore(null)
    setError('')
    setPaused(false)
    void window.api
      .getFileReview({ changeRecordId: record.id })
      .then((result) => {
        if (cancelled) return
        if (!result.success) setError(result.error)
        else if (result.content.kind === 'text') setBefore(result.content.before)
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [record.id, record.previewPath, reloadToken])
  const ready =
    before !== null && file.initialText !== null && !file.loading && !error && !file.loadError
  useEffect(() => {
    if (!ready || !container.current || before === null) return
    const language = /\.(md|markdown)$/i.test(record.path) ? 'markdown' : 'plaintext'
    const left = monaco.editor.createModel(before, language)
    const right = monaco.editor.createModel(fileRef.current.getText(), language)
    original.current = left
    modified.current = right
    const changed = right.onDidChangeContent(() => {
      if (!suppressChange.current) fileRef.current.autoSave(right.getValue())
    })
    return () => {
      changed.dispose()
      left.dispose()
      right.dispose()
      original.current = null
      modified.current = null
    }
  }, [ready, before, record.path])
  useEffect(() => {
    if (!ready || !container.current || !original.current || !modified.current) return
    const left = original.current,
      right = modified.current
    const host = container.current
    const controls: monaco.IDisposable[] = []
    const editors: monaco.editor.IStandaloneCodeEditor[] = []
    let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
    const options: monaco.editor.IStandaloneEditorConstructionOptions = {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 24,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      theme: 'curator-review',
      readOnly: fileRef.current.readOnly,
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false }
    }
    if (!paused) {
      diffEditor = monaco.editor.createDiffEditor(host, {
        ...options,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        diffWordWrap: 'on',
        ignoreTrimWhitespace: false,
        renderMarginRevertIcon: true,
        maxComputationTime: 2000,
        hideUnchangedRegions: { enabled: foldRef.current, contextLineCount: 3 }
      })
      diffEditor.setModel({ original: left, modified: right })
      diff.current = diffEditor
      controls.push(
        diffEditor.onDidUpdateDiff(() => {
          const result = (
            diffEditor as
              | (monaco.editor.IStandaloneDiffEditor & {
                  getDiffComputationResult(): { quitEarly: boolean } | null
                })
              | null
          )?.getDiffComputationResult()
          if (result?.quitEarly) {
            setPaused(true)
            return
          }
          let insertCount = 0,
            deleteCount = 0
          for (const change of diffEditor?.getLineChanges() || []) {
            if (change.modifiedEndLineNumber)
              insertCount += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
            if (change.originalEndLineNumber)
              deleteCount += change.originalEndLineNumber - change.originalStartLineNumber + 1
          }
          countsRef.current({ insertCount, deleteCount })
        })
      )
    } else {
      host.style.display = 'flex'
      for (const [model, readOnly] of [
        [left, true],
        [right, fileRef.current.readOnly]
      ] as const) {
        const pane = document.createElement('div')
        pane.style.cssText = 'width:50%;height:100%;min-width:0;border-right:1px solid #eee'
        host.appendChild(pane)
        editors.push(monaco.editor.create(pane, { ...options, model, readOnly }))
      }
    }
    const edit = diffEditor?.getModifiedEditor() || editors[1]
    modifiedEditor.current = edit
    edit.restoreViewState(rightViewState.current)
    controls.push(
      edit.onDidBlurEditorWidget(() => {
        void fileRef.current.flushSave().catch(() => undefined)
      })
    )
    return () => {
      rightViewState.current = edit.saveViewState()
      modifiedEditor.current = null
      controls.forEach((c) => c.dispose())
      diff.current = null
      diffEditor?.dispose()
      editors.forEach((e) => e.dispose())
      host.replaceChildren()
      host.style.display = ''
    }
  }, [ready, before, paused, record.path])
  useEffect(() => {
    const model = modified.current
    if (model && file.initialText !== null && file.initialText !== model.getValue()) {
      suppressChange.current = true
      model.setValue(file.initialText)
      suppressChange.current = false
    }
  }, [file.initialText])
  useEffect(() => {
    diff.current?.updateOptions({ readOnly: file.readOnly })
    modifiedEditor.current?.updateOptions({ readOnly: file.readOnly })
  }, [file.readOnly])
  if (error || file.loadError)
    return (
      <div role="alert" className="p-5 text-sm text-[#B3261E]">
        {error || file.loadError}
        <Button
          onClick={() => {
            setReloadToken((value) => value + 1)
            void file.reload()
          }}
        >
          重新加载
        </Button>
      </div>
    )
  if (!ready)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={workbenchSelectors.textDiffViewer}>
      <div className="grid shrink-0 grid-cols-2 border-b border-[#EEEEEC] py-1 text-xs text-[#787774]">
        <span className="px-3">本次运行前 · 只读</span>
        <span className="px-3">当前文件 · 可编辑</span>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-[#EEEEEC] px-2 py-1 text-xs text-[#787774]">
        <Button size="small" disabled={paused} onClick={() => diff.current?.goToDiff('previous')}>
          上一处
        </Button>
        <Button size="small" disabled={paused} onClick={() => diff.current?.goToDiff('next')}>
          下一处
        </Button>
        <Button
          size="small"
          disabled={paused}
          onClick={() => {
            setFold(!fold)
            diff.current?.updateOptions({
              hideUnchangedRegions: { enabled: !fold, contextLineCount: 3 }
            })
          }}
        >
          {fold ? '展开未修改内容' : '折叠未修改内容'}
        </Button>
      </div>
      {file.saveError && (
        <div role="alert" className="bg-[#F8EBE9] px-3 py-1 text-xs text-[#B3261E]">
          {file.saveError}
          <Button
            size="small"
            onClick={() => {
              void file.flushSave().catch(() => undefined)
            }}
          >
            重试保存
          </Button>
        </div>
      )}
      {paused && (
        <div role="status" className="bg-[#FBF3DB] px-3 py-1 text-xs">
          差异计算超时，已暂停自动比较，仍可编辑和保存完整内容。
          <Button size="small" onClick={() => setPaused(false)}>
            重新比较
          </Button>
        </div>
      )}
      <div ref={container} className="min-h-0 flex-1" />
    </div>
  )
}
