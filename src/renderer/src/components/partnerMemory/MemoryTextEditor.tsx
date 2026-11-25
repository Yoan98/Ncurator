import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { applyReviewTheme, monaco, reviewThemeFor } from '../workbench/monacoReview'
import { useAppearance } from '../../contexts/AppearanceContext'
import { t } from '../../i18n'

interface Marker {
  top: number
  removed: boolean
}

export default function MemoryTextEditor({
  text,
  confirmed,
  pending,
  active,
  label,
  onChange
}: {
  text: string
  confirmed: string
  pending: boolean
  active: boolean
  label: string
  onChange: (text: string, previous: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const original = useRef<monaco.editor.ITextModel | null>(null)
  const modified = useRef<monaco.editor.ITextModel | null>(null)
  const suppress = useRef(false)
  const scrollTop = useRef(0)
  const latest = useRef({ text, confirmed, pending, active, onChange })
  useLayoutEffect(() => {
    latest.current = { text, confirmed, pending, active, onChange }
  }, [text, confirmed, pending, active, onChange])
  const appearance = useAppearance()
  const theme = useRef(appearance.resolved)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [viewport, setViewport] = useState({ top: 0, height: 100 })
  const refreshRail = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (!host.current) return
    const left = monaco.editor.createModel(
      latest.current.pending ? latest.current.confirmed : latest.current.text,
      'plaintext'
    )
    const right = monaco.editor.createModel(latest.current.text, 'plaintext')
    original.current = left
    modified.current = right
    const diff = monaco.editor.createDiffEditor(host.current, {
      theme: reviewThemeFor(theme.current),
      renderSideBySide: false,
      experimental: { useTrueInlineView: true, showEmptyDecorations: false },
      originalEditable: false,
      readOnly: false,
      editContext: false,
      renderIndicators: false,
      renderMarginRevertIcon: false,
      renderGutterMenu: false,
      renderOverviewRuler: false,
      enableSplitViewResizing: false,
      hideUnchangedRegions: { enabled: false },
      ignoreTrimWhitespace: false,
      diffAlgorithm: 'advanced',
      diffWordWrap: 'on',
      wordWrap: 'on',
      automaticLayout: true,
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 14,
      lineHeight: 25,
      padding: { top: 10, bottom: 28 },
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
    })
    diff.setModel({ original: left, modified: right })
    editor.current = diff
    const edit = diff.getModifiedEditor()
    const updateRail = (): void => {
      const height = Math.max(1, edit.getScrollHeight())
      const visibleHeight = edit.getLayoutInfo().height
      setViewport({
        top: (edit.getScrollTop() / height) * 100,
        height: Math.min(100, (visibleHeight / height) * 100)
      })
      const next: Marker[] = []
      const add = (line: number, column: number, removed: boolean): void => {
        const safeLine = Math.max(1, Math.min(right.getLineCount(), line))
        const safeColumn = Math.max(1, Math.min(right.getLineMaxColumn(safeLine), column))
        next.push({
          top: Math.min(99, (edit.getTopForPosition(safeLine, safeColumn) / height) * 100),
          removed
        })
      }
      if (latest.current.pending)
        for (const change of diff.getLineChanges() ?? []) {
          if (change.charChanges?.length)
            for (const chars of change.charChanges) {
              if (
                chars.originalStartLineNumber !== chars.originalEndLineNumber ||
                chars.originalStartColumn !== chars.originalEndColumn
              )
                add(chars.modifiedStartLineNumber, chars.modifiedStartColumn, true)
              if (
                chars.modifiedStartLineNumber !== chars.modifiedEndLineNumber ||
                chars.modifiedStartColumn !== chars.modifiedEndColumn
              )
                add(chars.modifiedStartLineNumber, chars.modifiedStartColumn, false)
            }
          else {
            if (change.originalEndLineNumber) add(change.modifiedStartLineNumber, 1, true)
            if (change.modifiedEndLineNumber) add(change.modifiedStartLineNumber, 1, false)
          }
        }
      setMarkers(next)
    }
    refreshRail.current = updateRail
    let previousValue = right.getValue()
    const disposables = [
      right.onDidChangeContent(() => {
        const value = right.getValue()
        const before = previousValue
        previousValue = value
        if (suppress.current) return
        if (!latest.current.pending) left.setValue(value)
        latest.current.onChange(value, before)
      }),
      edit.onDidScrollChange(() => {
        if (latest.current.active) scrollTop.current = edit.getScrollTop()
        updateRail()
      }),
      edit.onDidLayoutChange(updateRail),
      edit.onDidContentSizeChange(updateRail),
      diff.onDidUpdateDiff(updateRail)
    ]
    updateRail()
    return () => {
      disposables.forEach((item) => item.dispose())
      editor.current = null
      original.current = null
      modified.current = null
      refreshRail.current = () => undefined
      diff.dispose()
      left.dispose()
      right.dispose()
    }
  }, [label])

  useEffect(() => {
    applyReviewTheme(appearance.resolved)
  }, [appearance.resolved])
  useLayoutEffect(() => {
    const right = modified.current
    const left = original.current
    const edit = editor.current?.getModifiedEditor()
    if (!right || !left || !edit) return
    if (right.getValue() !== text) {
      // Apply a minimal edit, preserving the native undo stack and cursor around incoming changes.
      const previous = right.getValue()
      let start = 0
      while (start < previous.length && start < text.length && previous[start] === text[start])
        start++
      let end = previous.length,
        nextEnd = text.length
      while (end > start && nextEnd > start && previous[end - 1] === text[nextEnd - 1]) {
        end--
        nextEnd--
      }
      suppress.current = true
      const from = right.getPositionAt(start),
        to = right.getPositionAt(end)
      edit.executeEdits('memory-update', [
        {
          range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
          text: text.slice(start, nextEnd)
        }
      ])
      suppress.current = false
    }
    const baseline = pending ? confirmed : text
    if (left.getValue() !== baseline) left.setValue(baseline)
    refreshRail.current()
  }, [text, confirmed, pending])
  useLayoutEffect(() => {
    if (!active || !editor.current) return
    const savedTop = scrollTop.current
    const restore = (): void => {
      editor.current?.layout()
      editor.current?.getModifiedEditor().setScrollTop(savedTop)
      refreshRail.current()
    }
    restore()
    const frame = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(frame)
  }, [active])

  const scrollTo = (clientY: number): void => {
    const element = rail.current
    const edit = editor.current?.getModifiedEditor()
    if (!element || !edit) return
    const bounds = element.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height))
    edit.setScrollTop(ratio * edit.getScrollHeight() - edit.getLayoutInfo().height / 2)
  }
  return (
    <div className="nc-memory-input" data-pending={pending}>
      <div ref={host} className="nc-memory-editor" />
      <div
        ref={rail}
        className="nc-memory-rail"
        role="scrollbar"
        aria-label={t(($) => $.partnerMemory.scroll)}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(viewport.top)}
        tabIndex={viewport.height < 100 ? 0 : -1}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          scrollTo(event.clientY)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) scrollTo(event.clientY)
        }}
        onKeyDown={(event) => {
          const edit = editor.current?.getModifiedEditor()
          if (!edit) return
          const delta = { ArrowDown: 25, ArrowUp: -25, PageDown: 250, PageUp: -250 }[event.key]
          if (delta) {
            event.preventDefault()
            edit.setScrollTop(edit.getScrollTop() + delta)
          }
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            edit.setScrollTop(event.key === 'Home' ? 0 : edit.getScrollHeight())
          }
        }}
      >
        <span
          className="nc-memory-viewport"
          style={{
            top: `${viewport.top}%`,
            height: `${viewport.height}%`,
            visibility: viewport.height >= 100 ? 'hidden' : 'visible'
          }}
        />
        {markers.map((marker, index) => (
          <span
            key={index}
            className={`nc-memory-marker ${marker.removed ? 'removed' : 'added'}`}
            style={{ top: `${marker.top}%` }}
          />
        ))}
      </div>
    </div>
  )
}
