import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Spin, Tooltip } from 'antd'
import { HiArrowDown, HiArrowUp } from 'react-icons/hi2'
import { LuFoldVertical, LuUnfoldVertical } from 'react-icons/lu'
import type { AiFileChangeRecord } from '../../../../shared/types'
import { useEditableTextFile } from '../fileRenders/useEditableTextFile'
import { workbenchSelectors } from '../../testing/selectors'
import { monaco } from './monacoReview'

type Counts = { insertCount: number; deleteCount: number }
const reviewActionClass =
  '!h-7 !w-7 !min-w-7 !rounded-[6px] !p-0 !text-[#91918E] hover:!bg-[#F4F4F2] hover:!text-[#37352F] focus-visible:!outline-2 focus-visible:!outline-[#0B6BCB] focus-visible:!outline-offset-[-2px]'
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
    modified.current = right
    const changed = right.onDidChangeContent(() => {
      if (!suppressChange.current) fileRef.current.autoSave(right.getValue())
    })
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
      changed.dispose()
      modified.current = null
      left.dispose()
      right.dispose()
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
    <div
      className="text-file-review flex h-full min-h-0 flex-col"
      data-testid={workbenchSelectors.textDiffViewer}
    >
      <div
        role="toolbar"
        aria-label="文本审核"
        className="grid h-9 shrink-0 grid-cols-2 items-center border-b border-[#EEEEEC] text-xs text-[#787774]"
      >
        <span className="px-3" title="只读">
          本次运行前
        </span>
        <div className="flex min-w-0 items-center justify-between gap-2 pl-3 pr-2">
          <span className="truncate" title={file.readOnly ? '只读' : '可编辑'}>
            {file.readOnly ? '当前文件（只读）' : '当前文件（可编辑）'}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip title="上一处差异">
              <Button
                type="text"
                aria-label="上一处差异"
                className={reviewActionClass}
                disabled={paused}
                icon={<HiArrowUp className="h-4 w-4" />}
                onClick={() => diff.current?.goToDiff('previous')}
              />
            </Tooltip>
            <Tooltip title="下一处差异">
              <Button
                type="text"
                aria-label="下一处差异"
                className={reviewActionClass}
                disabled={paused}
                icon={<HiArrowDown className="h-4 w-4" />}
                onClick={() => diff.current?.goToDiff('next')}
              />
            </Tooltip>
            <Tooltip title={fold ? '展开未修改内容' : '折叠未修改内容'}>
              <Button
                type="text"
                aria-label={fold ? '展开未修改内容' : '折叠未修改内容'}
                aria-pressed={fold}
                className={reviewActionClass}
                disabled={paused}
                icon={
                  fold ? (
                    <LuUnfoldVertical className="h-4 w-4" />
                  ) : (
                    <LuFoldVertical className="h-4 w-4" />
                  )
                }
                onClick={() => {
                  setFold(!fold)
                  diff.current?.updateOptions({
                    hideUnchangedRegions: { enabled: !fold, contextLineCount: 3 }
                  })
                }}
              />
            </Tooltip>
          </div>
        </div>
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
