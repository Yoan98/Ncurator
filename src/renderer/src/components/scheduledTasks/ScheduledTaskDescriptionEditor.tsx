import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import '../fileRenders/markdownEditor.css'
import type { ReferenceKind, SelectedReference } from '../../../../shared/types'
import { REFERENCE_ITEM_PAGE_SIZE } from '../../../../shared/types'
import { vditorI18n } from '../fileRenders/vditorI18n'
import { getReferenceKey } from '../../utils/reference'
import { scheduledTaskSelectors } from '../../testing/selectors'
import ReferenceMentionPanel from '../workbench/composer/ReferenceMentionPanel'
import ReferenceInlineToken from '../workbench/composer/ReferenceInlineToken'
import { COMPOSER_REFERENCE_KINDS } from '../workbench/composer/constants'
import { HiXMark } from 'react-icons/hi2'

type MentionContext = {
  textNode: Text
  triggerIndex: number
  caretOffset: number
  query: string
}

type Props = {
  value: string
  selectedReferences: SelectedReference[]
  onChange: (value: string, references: SelectedReference[]) => void
}

export type ScheduledTaskDescriptionEditorHandle = {
  getValue: () => string
}

const readMentionContext = (root: HTMLElement): MentionContext | null => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return null
  const textNode = selection.anchorNode
  if (!(textNode instanceof Text) || !root.contains(textNode)) return null
  const before = textNode.data.slice(0, selection.anchorOffset)
  const triggerIndex = before.lastIndexOf('@')
  if (triggerIndex < 0 || /\s/u.test(before.slice(triggerIndex + 1))) return null
  const previous = triggerIndex > 0 ? before[triggerIndex - 1] : ''
  if (previous && !/[\s([{,，。；;、]/u.test(previous)) return null
  return {
    textNode,
    triggerIndex,
    caretOffset: selection.anchorOffset,
    query: before.slice(triggerIndex + 1)
  }
}

const ScheduledTaskDescriptionEditor = forwardRef<ScheduledTaskDescriptionEditorHandle, Props>(
  ({ value, selectedReferences, onChange }, forwardedRef) => {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<Vditor | null>(null)
    const editorRootRef = useRef<HTMLElement | null>(null)
    const valueRef = useRef(value)
    const onChangeRef = useRef(onChange)
    const selectedReferencesRef = useRef(selectedReferences)
    const refreshMentionRef = useRef<() => void>(() => undefined)
    const keyDownHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
    const keyDownListenerRef = useRef<((event: KeyboardEvent) => void) | null>(null)
    const mentionContextRef = useRef<MentionContext | null>(null)
    const requestIdRef = useRef(0)
    const loadedOffsetRef = useRef(0)
    const [ready, setReady] = useState(false)
    const [mentionQuery, setMentionQuery] = useState<string | null>(null)
    const [mentionOptions, setMentionOptions] = useState<SelectedReference[]>([])
    const [mentionIndex, setMentionIndex] = useState(0)
    const [mentionLoading, setMentionLoading] = useState(false)
    const [mentionLoadingMore, setMentionLoadingMore] = useState(false)
    const [mentionHasMore, setMentionHasMore] = useState(false)

    useImperativeHandle(
      forwardedRef,
      () => ({ getValue: () => editorRef.current?.getValue() ?? value }),
      [value]
    )

    const refreshMention = useCallback((): void => {
      const editorRoot = editorRootRef.current
      if (!editorRoot) return
      const context = readMentionContext(editorRoot)
      mentionContextRef.current = context
      if (!context) {
        requestIdRef.current += 1
        setMentionQuery(null)
        setMentionOptions([])
        setMentionHasMore(false)
        return
      }
      setMentionQuery(context.query)
      setMentionLoading(true)
      setMentionLoadingMore(false)
      const requestId = ++requestIdRef.current
      void window.api
        .referenceItemList({
          referenceKinds: COMPOSER_REFERENCE_KINDS as ReferenceKind[],
          query: context.query || undefined,
          offset: 0,
          limit: REFERENCE_ITEM_PAGE_SIZE
        })
        .then((response) => {
          if (requestIdRef.current !== requestId) return
          loadedOffsetRef.current = response.offset + response.items.length
          setMentionOptions(response.items)
          setMentionHasMore(response.hasMore)
          setMentionIndex(0)
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setMentionOptions([])
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setMentionLoading(false)
        })
    }, [])

    useEffect(() => {
      valueRef.current = value
      onChangeRef.current = onChange
      selectedReferencesRef.current = selectedReferences
    }, [onChange, selectedReferences, value])

    useEffect(() => {
      refreshMentionRef.current = refreshMention
    }, [refreshMention])

    const loadMoreMentions = useCallback((): void => {
      const query = mentionQuery
      if (query === null || !mentionHasMore || mentionLoadingMore) return
      setMentionLoadingMore(true)
      const requestId = requestIdRef.current
      void window.api
        .referenceItemList({
          referenceKinds: COMPOSER_REFERENCE_KINDS as ReferenceKind[],
          query: query || undefined,
          offset: loadedOffsetRef.current,
          limit: REFERENCE_ITEM_PAGE_SIZE
        })
        .then((response) => {
          if (requestIdRef.current !== requestId) return
          loadedOffsetRef.current = response.offset + response.items.length
          setMentionOptions((current) => [...current, ...response.items])
          setMentionHasMore(response.hasMore)
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setMentionLoadingMore(false)
        })
    }, [mentionHasMore, mentionLoadingMore, mentionQuery])

    const selectMention = useCallback(
      (reference: SelectedReference): void => {
        const context = mentionContextRef.current
        const editor = editorRef.current
        const editorRoot = editorRootRef.current
        if (!context || !editor || !editorRoot || !editorRoot.contains(context.textNode)) return
        const range = document.createRange()
        range.setStart(context.textNode, context.triggerIndex)
        range.setEnd(context.textNode, context.caretOffset)
        range.deleteContents()
        range.collapse(true)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        const nextReferences = selectedReferences.some(
          (item) => getReferenceKey(item) === getReferenceKey(reference)
        )
          ? selectedReferences
          : [...selectedReferences, reference]
        selectedReferencesRef.current = nextReferences
        onChangeRef.current(editor.getValue(), nextReferences)
        editorRoot.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null })
        )
        mentionContextRef.current = null
        setMentionQuery(null)
        setMentionOptions([])
        editor.focus()
      },
      [selectedReferences]
    )

    useEffect(() => {
      const host = hostRef.current
      if (!host) return
      let mounted = true
      // StrictMode replays effect cleanup immediately; let that pass cancel before Vditor is created.
      const initializeTimer = window.setTimeout(() => {
        if (!mounted || !host.isConnected || editorRef.current) return
        host.replaceChildren()
        const editor = new Vditor(host, {
          mode: 'ir',
          lang: 'zh_CN',
          i18n: vditorI18n,
          toolbar: [],
          cache: { enable: false },
          value: valueRef.current,
          cdn: new URL('vditor', document.baseURI).href,
          placeholder: '描述你希望伙伴完成的事，也可使用 Markdown 和 @ 引用',
          preview: {
            delay: 80,
            hljs: { enable: true, lineNumber: false, style: 'a11y-light' },
            markdown: { gfmAutoLink: true, footnotes: true }
          },
          input: (nextValue) => {
            if (!mounted) return
            onChangeRef.current(nextValue, selectedReferencesRef.current)
            refreshMentionRef.current()
          },
          after: () => {
            if (!mounted || editorRef.current !== editor) return
            editorRootRef.current = host.querySelector<HTMLElement>('.vditor-ir .vditor-reset')
            if (editorRootRef.current) {
              editorRootRef.current.dataset.testid = scheduledTaskSelectors.formDescriptionInput
              keyDownListenerRef.current = (event) => keyDownHandlerRef.current(event)
              editorRootRef.current.addEventListener('keydown', keyDownListenerRef.current)
            }
            setReady(true)
          }
        })
        editorRef.current = editor
      }, 0)
      return () => {
        mounted = false
        window.clearTimeout(initializeTimer)
        requestIdRef.current += 1
        if (editorRootRef.current && keyDownListenerRef.current) {
          editorRootRef.current.removeEventListener('keydown', keyDownListenerRef.current)
        }
        keyDownListenerRef.current = null
        const editor = editorRef.current
        if (editor) {
          try {
            editor.destroy()
          } catch (error) {
            console.error('[SCHEDULED-TASK] Vditor destroy failed:', error)
          }
          editorRef.current = null
        }
        editorRootRef.current = null
      }
    }, [])

    const handleEditorKeyDown = useCallback(
      (event: KeyboardEvent): void => {
        if (mentionQuery === null) return
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setMentionIndex((index) =>
            mentionOptions.length ? (index + 1) % mentionOptions.length : 0
          )
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setMentionIndex((index) =>
            mentionOptions.length ? (index + mentionOptions.length - 1) % mentionOptions.length : 0
          )
        } else if (event.key === 'Enter') {
          event.preventDefault()
          const option = mentionOptions[mentionIndex]
          if (option) selectMention(option)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          mentionContextRef.current = null
          setMentionQuery(null)
          setMentionOptions([])
        }
      },
      [mentionIndex, mentionOptions, mentionQuery, selectMention]
    )

    useEffect(() => {
      keyDownHandlerRef.current = handleEditorKeyDown
    }, [handleEditorKeyDown])

    useEffect(() => {
      if (!ready || !editorRef.current || editorRef.current.getValue() === value) return
      editorRef.current.setValue(value)
    }, [ready, value])

    const removeReference = (reference: SelectedReference): void => {
      const nextReferences = selectedReferences.filter(
        (item) => getReferenceKey(item) !== getReferenceKey(reference)
      )
      selectedReferencesRef.current = nextReferences
      onChange(value, nextReferences)
    }

    return (
      <div className="relative" data-testid={scheduledTaskSelectors.formDescription}>
        {mentionQuery !== null ? (
          <ReferenceMentionPanel
            loading={mentionLoading}
            loadingMore={mentionLoadingMore}
            options={mentionOptions}
            activeIndex={mentionIndex}
            hasMore={mentionHasMore}
            onSelect={selectMention}
            onLoadMore={loadMoreMentions}
          />
        ) : null}
        <div
          ref={hostRef}
          className="scheduled-task-markdown min-h-[240px] overflow-hidden rounded-[8px] border border-[#E5E4E0] bg-white"
        />
        {selectedReferences.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            data-testid={scheduledTaskSelectors.formReferenceList}
          >
            {selectedReferences.map((reference) => (
              <span
                key={getReferenceKey(reference)}
                className="inline-flex max-w-full items-center gap-1 rounded-[6px] border border-[#EEEEEC] bg-[#FBFBFA] py-1 pl-2 pr-1"
              >
                <ReferenceInlineToken reference={reference} role="scope-token" />
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[#91918E] hover:bg-[#EFEFEE] hover:text-[#37352F]"
                  aria-label={`移除引用 ${reference.name}`}
                  onClick={() => removeReference(reference)}
                >
                  <HiXMark className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    )
  }
)

ScheduledTaskDescriptionEditor.displayName = 'ScheduledTaskDescriptionEditor'

export default ScheduledTaskDescriptionEditor
