import { useEffect, useRef, useState } from 'react'
import { Checkbox, Input, Popover, Tooltip, message, type InputRef } from 'antd'
import { PiCaretDown, PiCaretUp, PiMagnifyingGlass, PiSlidersHorizontal, PiX } from 'react-icons/pi'
import type { SuperDoc } from 'superdoc'
import { t } from '../../i18n'

export default function DocxSearch({
  editor,
  replaceVisible,
  close
}: {
  editor: SuperDoc
  replaceVisible: boolean
  close: () => void
}) {
  const input = useRef<InputRef>(null)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [snapshot, setSnapshot] = useState(() => editor.ui.search.getSnapshot())
  const [pending, setPending] = useState(false)
  const working = useRef(false)
  const text = t(($) => $.editors.wordSearch, { returnObjects: true })
  useEffect(() => {
    const stop = editor.ui.search.observe(setSnapshot)
    const result = editor.ui.search.open()
    if (!result.ok) message.info(t(($) => $.editors.wordRibbon.searchUnavailable))
    return () => {
      stop()
      editor.ui.search.close()
    }
  }, [editor])
  useEffect(() => {
    input.current?.focus()
  }, [replaceVisible])
  useEffect(() => {
    const timer = setTimeout(() => {
      editor.ui.search.find(query, { caseSensitive, regex })
    }, 120)
    return () => clearTimeout(timer)
  }, [editor, query, caseSensitive, regex])
  const matchingQuery =
    snapshot.query === query && snapshot.caseSensitive === caseSensitive && snapshot.regex === regex
  const invalid = matchingQuery && snapshot.reason === 'search-invalid-pattern'
  const count =
    !query || !matchingQuery
      ? ''
      : invalid
        ? text.invalidPattern
        : snapshot.total
          ? `${snapshot.activeIndex + 1}/${snapshot.total}`
          : text.noResults
  const navigate = (previous = false) => {
    if (!matchingQuery || !snapshot.total) return
    const result = previous ? editor.ui.search.previous() : editor.ui.search.next()
    if (!result.ok) message.info(t(($) => $.editors.operationFailed))
    input.current?.focus()
  }
  const replace = async (all: boolean) => {
    if (working.current) return
    working.current = true
    setPending(true)
    try {
      const result = await (all
        ? editor.ui.search.replaceAll(replacement)
        : editor.ui.search.replace(replacement))
      if (!result.ok) message.info(t(($) => $.editors.operationFailed))
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      working.current = false
      setPending(false)
      input.current?.focus()
    }
  }
  return (
    <div
      className="nc-docx-search"
      role="search"
      onKeyDown={(event) => {
        // Typing and shortcuts in this strip belong to inputs, never to the document canvas.
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
    >
      <div className="nc-docx-search-row">
        <Input
          ref={input}
          size="small"
          value={query}
          prefix={<PiMagnifyingGlass />}
          aria-label={text.findAriaLabel}
          placeholder={text.findPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={(event) => {
            if (!event.nativeEvent.isComposing) navigate(event.shiftKey)
          }}
          suffix={
            <span className="nc-docx-search-count" aria-live="polite">
              {count}
            </span>
          }
        />
        {([false, true] as const).map((next) => (
          <Tooltip key={String(next)} title={next ? text.nextMatchTitle : text.previousMatchTitle}>
            <button
              type="button"
              aria-label={next ? text.nextMatchAriaLabel : text.previousMatchAriaLabel}
              disabled={!matchingQuery || !snapshot.total}
              onClick={() => navigate(!next)}
            >
              {next ? <PiCaretDown /> : <PiCaretUp />}
            </button>
          </Tooltip>
        ))}
        <Popover
          trigger="click"
          content={
            <div className="nc-docx-search-options">
              <Checkbox
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              >
                {text.matchCase}
              </Checkbox>
              <Checkbox checked={regex} onChange={(e) => setRegex(e.target.checked)}>
                {text.regex}
              </Checkbox>
            </div>
          }
        >
          <Tooltip title={t(($) => $.editors.wordRibbon.searchOptions)}>
            <button type="button" aria-label={t(($) => $.editors.wordRibbon.searchOptions)}>
              <PiSlidersHorizontal />
            </button>
          </Tooltip>
        </Popover>
        <Tooltip title={text.closeTitle}>
          <button type="button" aria-label={text.closeAriaLabel} onClick={close}>
            <PiX />
          </button>
        </Tooltip>
      </div>
      {replaceVisible && (
        <div className="nc-docx-search-row">
          <Input
            size="small"
            aria-label={text.replaceAriaLabel}
            placeholder={text.replacePlaceholder}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onPressEnter={(event) => {
              if (!event.nativeEvent.isComposing) void replace(false)
            }}
          />
          <button
            type="button"
            disabled={pending || !matchingQuery || !snapshot.canReplace}
            onClick={() => void replace(false)}
          >
            {text.replace}
          </button>
          <button
            type="button"
            disabled={pending || !matchingQuery || !snapshot.canReplaceAll}
            onClick={() => void replace(true)}
          >
            {text.replaceAll}
          </button>
        </div>
      )}
    </div>
  )
}
