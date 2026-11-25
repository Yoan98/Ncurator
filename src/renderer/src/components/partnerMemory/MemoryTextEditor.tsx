import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { applyReviewTheme, monaco, reviewThemeFor } from '../workbench/monacoReview'
import 'monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution.js'
import ChangeOverviewRuler, { type OverviewMarker } from '../workbench/ChangeOverviewRuler'
import { measureOverviewViewport, type OverviewViewport } from '../workbench/changeOverviewGeometry'
import { useAppearance } from '../../contexts/AppearanceContext'
import { t } from '../../i18n'

type Marker = OverviewMarker & { line: number; column: number }

export default function MemoryTextEditor({
  text,
  confirmed,
  pending,
  active,
  label,
  placeholder,
  onChange
}: {
  text: string
  confirmed: string
  pending: boolean
  active: boolean
  label: string
  placeholder: string
  onChange: (text: string, previous: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const models = useRef<{
    original: monaco.editor.ITextModel
    modified: monaco.editor.ITextModel
  } | null>(null)
  const editor = useRef<monaco.editor.ICodeEditor | null>(null)
  const suppress = useRef(false)
  const scrollTop = useRef(0)
  const viewState = useRef<monaco.editor.ICodeEditorViewState | null>(null)
  const latest = useRef({ text, confirmed, pending, active, placeholder, onChange })
  useLayoutEffect(() => {
    latest.current = { text, confirmed, pending, active, placeholder, onChange }
  }, [text, confirmed, pending, active, placeholder, onChange])
  const appearance = useAppearance()
  const theme = useRef(appearance.resolved)
  const [overview, setOverview] = useState<{
    markers: Marker[]
    viewport: OverviewViewport | null
  }>({ markers: [], viewport: null })
  const [contentHeight, setContentHeight] = useState(64)
  const refresh = useRef<() => void>(() => undefined)

  // Models outlive the plain/diff widgets, retaining native undo and cursor history on review.
  useEffect(() => {
    const original = monaco.editor.createModel(
      latest.current.pending ? latest.current.confirmed : latest.current.text,
      'plaintext'
    )
    const modified = monaco.editor.createModel(latest.current.text, 'plaintext')
    models.current = { original, modified }
    return () => {
      models.current = null
      original.dispose()
      modified.dispose()
    }
  }, [label])

  useEffect(() => {
    if (!host.current || !models.current) return
    const { original, modified } = models.current
    const options: monaco.editor.IStandaloneEditorConstructionOptions = {
      theme: reviewThemeFor(theme.current),
      readOnly: false,
      editContext: false,
      wordWrap: 'on',
      wrappingIndent: 'none',
      wrappingStrategy: 'advanced',
      disableMonospaceOptimizations: true,
      automaticLayout: true,
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 14,
      lineHeight: 25,
      padding: { top: 10, bottom: 14 },
      minimap: { enabled: false },
      lineNumbers: 'off',
      lineNumbersMinChars: 0,
      lineDecorationsWidth: 0,
      glyphMargin: false,
      folding: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      scrollBeyondLastLine: false,
      scrollbar: { vertical: 'hidden', horizontal: 'hidden', handleMouseWheel: true },
      renderLineHighlight: 'none',
      guides: { indentation: false },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      contextmenu: true,
      ariaLabel: label
    }
    const diff = pending
      ? monaco.editor.createDiffEditor(host.current, {
          ...options,
          renderSideBySide: false,
          // Inline mode otherwise retains a 5px original pane and clips its first character.
          compactMode: true,
          experimental: { useTrueInlineView: true, showEmptyDecorations: false },
          originalEditable: false,
          renderIndicators: false,
          renderMarginRevertIcon: false,
          renderGutterMenu: false,
          renderOverviewRuler: false,
          enableSplitViewResizing: false,
          hideUnchangedRegions: { enabled: false },
          ignoreTrimWhitespace: false,
          diffAlgorithm: 'advanced',
          diffWordWrap: 'on'
        })
      : null
    diff?.setModel({ original, modified })
    const plain = diff ? null : monaco.editor.create(host.current, { ...options, model: modified })
    const edit = diff?.getModifiedEditor() ?? plain!
    editor.current = edit
    const layout = (): void => {
      if (diff) diff.layout()
      else plain?.layout()
    }
    edit.updateOptions({
      placeholder: pending && latest.current.confirmed ? undefined : latest.current.placeholder
    })
    edit.restoreViewState(viewState.current)
    edit.setScrollTop(scrollTop.current)

    const measure = (): void => {
      if (latest.current.active) setContentHeight(Math.max(64, Math.ceil(edit.getContentHeight())))
      const trackHeight = rail.current?.clientHeight ?? 0
      if (!trackHeight) return
      const totalHeight = Math.max(1, edit.getScrollHeight())
      const viewport = measureOverviewViewport(
        edit.getScrollTop(),
        edit.getLayoutInfo().height,
        totalHeight,
        trackHeight
      )
      const markers: Marker[] = []
      const add = (
        line: number,
        column: number,
        endLine: number,
        endColumn: number,
        removed: boolean
      ): void => {
        const safeLine = Math.max(1, Math.min(modified.getLineCount(), line))
        const safeColumn = Math.max(1, Math.min(modified.getLineMaxColumn(safeLine), column))
        const lastLine = Math.max(safeLine, Math.min(modified.getLineCount(), endLine))
        const lastColumn = Math.max(1, Math.min(modified.getLineMaxColumn(lastLine), endColumn))
        const start = edit.getTopForPosition(safeLine, safeColumn)
        const extent = removed
          ? 25
          : Math.max(25, edit.getTopForPosition(lastLine, lastColumn) - start + 25)
        const top = Math.max(0, Math.min(trackHeight - 3, (start / totalHeight) * trackHeight))
        markers.push({
          key: `${markers.length}-${removed}`,
          top,
          height: Math.min(trackHeight - top, Math.max(3, (extent / totalHeight) * trackHeight)),
          tone: removed ? 'removed' : 'added',
          label: removed ? t(($) => $.common.delete) : t(($) => $.editors.add),
          line: safeLine,
          column: safeColumn
        })
      }
      for (const change of (latest.current.pending && diff?.getLineChanges()) || []) {
        if (change.charChanges?.length)
          for (const chars of change.charChanges) {
            if (
              chars.originalStartLineNumber !== chars.originalEndLineNumber ||
              chars.originalStartColumn !== chars.originalEndColumn
            )
              add(
                chars.modifiedStartLineNumber,
                chars.modifiedStartColumn,
                chars.modifiedStartLineNumber,
                chars.modifiedStartColumn,
                true
              )
            if (
              chars.modifiedStartLineNumber !== chars.modifiedEndLineNumber ||
              chars.modifiedStartColumn !== chars.modifiedEndColumn
            )
              add(
                chars.modifiedStartLineNumber,
                chars.modifiedStartColumn,
                chars.modifiedEndLineNumber,
                chars.modifiedEndColumn,
                false
              )
          }
        else {
          if (change.originalEndLineNumber)
            add(change.modifiedStartLineNumber, 1, change.modifiedStartLineNumber, 1, true)
          if (change.modifiedEndLineNumber)
            add(
              change.modifiedStartLineNumber,
              1,
              change.modifiedEndLineNumber,
              modified.getLineMaxColumn(
                Math.max(1, Math.min(modified.getLineCount(), change.modifiedEndLineNumber))
              ),
              false
            )
        }
      }
      setOverview((previous) =>
        previous.viewport?.top === viewport?.top &&
        previous.viewport?.height === viewport?.height &&
        previous.markers.length === markers.length &&
        previous.markers.every(
          (mark, index) =>
            mark.top === markers[index].top &&
            mark.height === markers[index].height &&
            mark.tone === markers[index].tone &&
            mark.line === markers[index].line &&
            mark.column === markers[index].column
        )
          ? previous
          : { markers, viewport }
      )
    }
    refresh.current = () => {
      layout()
      measure()
    }
    let previousValue = modified.getValue()
    const disposables = [
      modified.onDidChangeContent(() => {
        const value = modified.getValue(),
          before = previousValue
        previousValue = value
        if (suppress.current) return
        if (!latest.current.pending) original.setValue(value)
        latest.current.onChange(value, before)
      }),
      edit.onDidScrollChange(() => {
        if (latest.current.active) scrollTop.current = edit.getScrollTop()
        measure()
      }),
      edit.onDidLayoutChange(measure),
      edit.onDidContentSizeChange(measure)
    ]
    if (diff) disposables.push(diff.onDidUpdateDiff(measure))
    const resize = new ResizeObserver(measure)
    const track = rail.current
    if (track) resize.observe(track)
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? edit.getLayoutInfo().height
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 25
            : 1
      edit.setScrollTop(edit.getScrollTop() + event.deltaY * unit)
    }
    track?.addEventListener('wheel', wheel, { passive: false })
    measure()
    return () => {
      viewState.current = edit.saveViewState()
      disposables.forEach((item) => item.dispose())
      resize.disconnect()
      track?.removeEventListener('wheel', wheel)
      editor.current = null
      refresh.current = () => undefined
      diff?.setModel(null)
      plain?.setModel(null)
      diff?.dispose()
      plain?.dispose()
    }
  }, [label, pending])

  useEffect(() => {
    applyReviewTheme(appearance.resolved)
  }, [appearance.resolved])
  useLayoutEffect(() => {
    const current = models.current,
      edit = editor.current
    if (!current || !edit) return
    const { original, modified } = current
    if (modified.getValue() !== text) {
      const previous = modified.getValue()
      let start = 0
      while (start < previous.length && start < text.length && previous[start] === text[start])
        start++
      let end = previous.length,
        nextEnd = text.length
      while (end > start && nextEnd > start && previous[end - 1] === text[nextEnd - 1]) {
        end--
        nextEnd--
      }
      const from = modified.getPositionAt(start),
        to = modified.getPositionAt(end)
      suppress.current = true
      edit.executeEdits('memory-update', [
        {
          range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
          text: text.slice(start, nextEnd)
        }
      ])
      suppress.current = false
    }
    const baseline = pending ? confirmed : text
    if (original.getValue() !== baseline) original.setValue(baseline)
    edit.updateOptions({ placeholder: pending && confirmed ? undefined : placeholder })
    refresh.current()
  }, [text, confirmed, pending, placeholder])
  useLayoutEffect(() => {
    if (!active || !editor.current) return
    const savedTop = scrollTop.current
    const restore = (): void => {
      refresh.current()
      editor.current?.setScrollTop(savedTop)
    }
    restore()
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [active])

  const visible = overview.viewport !== null || (pending && overview.markers.length > 0)
  return (
    <div className="nc-memory-input" data-pending={pending} style={{ height: contentHeight }}>
      <div ref={host} className={`nc-memory-editor${pending ? '' : ' editor modified'}`} />
      <ChangeOverviewRuler
        variant={pending ? 'overview' : 'scrollbar'}
        trackRef={rail}
        className="nc-memory-rail"
        data-visible={visible}
        aria-hidden={!visible}
        role="navigation"
        aria-label={t(($) => $.partnerMemory.scroll)}
        tabIndex={visible ? 0 : -1}
        markers={pending ? overview.markers : []}
        viewport={overview.viewport}
        markerClassName="nc-memory-marker"
        viewportClassName="nc-memory-viewport"
        onActivate={(index) => {
          const mark = overview.markers[index]
          editor.current?.revealPositionInCenter({ lineNumber: mark.line, column: mark.column })
        }}
        onScrollRatio={(ratio) => {
          const edit = editor.current
          if (edit)
            edit.setScrollTop(ratio * (edit.getScrollHeight() - edit.getLayoutInfo().height))
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          const edit = editor.current
          if (!edit) return
          const steps: Record<string, number> = {
            ArrowDown: 25,
            ArrowUp: -25,
            PageDown: edit.getLayoutInfo().height,
            PageUp: -edit.getLayoutInfo().height,
            Home: -edit.getScrollHeight(),
            End: edit.getScrollHeight()
          }
          if (!(event.key in steps)) return
          event.preventDefault()
          edit.setScrollTop(edit.getScrollTop() + steps[event.key])
        }}
      />
    </div>
  )
}
