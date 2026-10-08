import React, { useEffect, useRef, useState } from 'react'
import type { ReferenceKind, SelectedReference } from '../../../../../shared/types'
import { REFERENCE_ITEM_PAGE_SIZE } from '../../../../../shared/types'
import { COMPOSER_REFERENCE_KINDS } from './constants'
import ReferenceMentionPanel from './ReferenceMentionPanel'
import type { ComposerDraftValue } from './types'
import {
  createComposerNodesFromDraftValue,
  createScopeTokenElement,
  extractComposerDraftValue,
  getScopeKey,
  moveCaretToTextNode,
  readComposerNodesFromEditor,
  removeComposerTokenBeforeCaret,
  renderComposerNodesToEditor
} from './utils'

type Props = {
  value: Pick<ComposerDraftValue, 'input' | 'contentNodes' | 'selectedReferences'>
  onChange: (
    value: Pick<ComposerDraftValue, 'input' | 'contentNodes' | 'selectedReferences'>
  ) => void
  disabled?: boolean
  onSubmit?: () => void
  placeholder?: string
  dataTestId?: string
  /** Extra classes for the editable surface (e.g. max-height + overflow for forms). */
  editorClassName?: string
}
type MentionContext = { textNode: Text; caretOffset: number; triggerIndex: number; query: string }

const isTextNode = (value: Node | null): value is Text => value instanceof Text

const ComposerInputEditor: React.FC<Props> = ({
  value,
  onChange,
  placeholder,
  dataTestId,
  editorClassName,
  disabled = false,
  onSubmit
}) => {
  const { input, contentNodes, selectedReferences } = value
  const composingRef = useRef(false)
  const compositionEndedAtRef = useRef(0)
  const editorRef = useRef<HTMLSpanElement | null>(null)
  const knownScopesRef = useRef(new Map<string, SelectedReference>())
  const lastEmittedSignatureRef = useRef<string | null>(null)
  const mentionRequestRef = useRef(0)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionOptions, setMentionOptions] = useState<SelectedReference[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)

  const refreshMention = (): void => {
    const context = mentionContext()
    if (!context) {
      setMentionQuery(null)
      setMentionOptions([])
      return
    }
    setMentionQuery(context.query)
    const requestId = mentionRequestRef.current + 1
    mentionRequestRef.current = requestId
    void window.api
      .referenceItemList({
        referenceKinds: COMPOSER_REFERENCE_KINDS as ReferenceKind[],
        query: context.query || undefined,
        offset: 0,
        limit: REFERENCE_ITEM_PAGE_SIZE
      })
      .then((response) => {
        if (mentionRequestRef.current !== requestId) return
        response.items.forEach((item) => knownScopesRef.current.set(getScopeKey(item), item))
        setMentionOptions(response.items)
        setMentionIndex(0)
      })
      .catch(() => {
        if (mentionRequestRef.current === requestId) setMentionOptions([])
      })
  }

  const sync = (): void => {
    const editor = editorRef.current
    if (!editor) return
    const nodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    const draft = extractComposerDraftValue(nodes)
    onChange({
      input: draft.input,
      contentNodes: draft.contentNodes,
      selectedReferences: draft.selectedReferences
    })
    lastEmittedSignatureRef.current = JSON.stringify({
      input: draft.input,
      contentNodes: draft.contentNodes,
      selectedReferences: draft.selectedReferences
    })
    refreshMention()
  }

  const mentionContext = (): MentionContext | null => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return null
    const node = selection.anchorNode
    if (!isTextNode(node) || !editor.contains(node)) return null
    const before = node.data.slice(0, selection.anchorOffset)
    const triggerIndex = before.lastIndexOf('@')
    if (triggerIndex < 0 || /\s/.test(before.slice(triggerIndex + 1))) return null
    const previous = triggerIndex > 0 ? before[triggerIndex - 1] : ''
    if (previous && !/[\s([{,，。；;、]/.test(previous)) return null
    return {
      textNode: node,
      caretOffset: selection.anchorOffset,
      triggerIndex,
      query: before.slice(triggerIndex + 1)
    }
  }

  useEffect(() => {
    const signature = JSON.stringify({ input, contentNodes, selectedReferences })
    if (signature === lastEmittedSignatureRef.current) return
    const nodes = createComposerNodesFromDraftValue({
      input,
      contentNodes,
      selectedReferences,
      attachments: []
    })
    nodes.forEach((node) => {
      if (node.kind === 'scope') knownScopesRef.current.set(getScopeKey(node.scope), node.scope)
    })
    if (editorRef.current) renderComposerNodesToEditor(editorRef.current, nodes)
    lastEmittedSignatureRef.current = signature
  }, [contentNodes, input, selectedReferences])

  const insertMention = (reference: SelectedReference): void => {
    const context = mentionContext()
    const editor = editorRef.current
    if (!context || !editor || !context.textNode.parentNode) return
    knownScopesRef.current.set(getScopeKey(reference), reference)
    const parent = context.textNode.parentNode
    const before = context.textNode.data.slice(0, context.triggerIndex)
    const after = context.textNode.data.slice(context.caretOffset)
    if (before) parent.insertBefore(document.createTextNode(before), context.textNode)
    parent.insertBefore(createScopeTokenElement(reference), context.textNode)
    const tail = document.createTextNode(after ? ` ${after}` : ' ')
    parent.insertBefore(tail, context.textNode)
    parent.removeChild(context.textNode)
    moveCaretToTextNode(tail, 1)
    setMentionQuery(null)
    setMentionOptions([])
    sync()
  }

  return (
    <div className="relative">
      {mentionQuery !== null ? (
        <ReferenceMentionPanel
          loading={false}
          loadingMore={false}
          options={mentionOptions}
          activeIndex={mentionIndex}
          hasMore={false}
          onSelect={insertMention}
          onLoadMore={() => undefined}
        />
      ) : null}
      <span
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-testid={dataTestId}
        data-placeholder={placeholder}
        className={`block min-h-[72px] whitespace-pre-wrap break-words rounded-[6px] border border-[#E5E4E0] px-3 py-2 text-[14px] leading-6 text-[#37352F] outline-none empty:before:pointer-events-none empty:before:text-[#9B9A97] empty:before:content-[attr(data-placeholder)] ${editorClassName || ''}`}
        onInput={sync}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          compositionEndedAtRef.current = Date.now()
          sync()
        }}
        onPaste={(event) => {
          event.preventDefault()
          if (disabled) return
          const selection = window.getSelection()
          if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode)) return
          const range = selection.getRangeAt(0)
          range.deleteContents()
          const text = document.createTextNode(event.clipboardData.getData('text/plain'))
          range.insertNode(text)
          moveCaretToTextNode(text, text.length)
          sync()
        }}
        onKeyDown={(event) => {
          if (
            disabled ||
            composingRef.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            Date.now() - compositionEndedAtRef.current < 80
          )
            return
          if (mentionQuery !== null) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMentionIndex((index) =>
                mentionOptions.length ? (index + 1) % mentionOptions.length : 0
              )
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMentionIndex((index) =>
                mentionOptions.length
                  ? (index + mentionOptions.length - 1) % mentionOptions.length
                  : 0
              )
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const option = mentionOptions[mentionIndex]
              if (option) insertMention(option)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMentionQuery(null)
              setMentionOptions([])
              return
            }
          }
          if (event.key === 'Enter' && !event.shiftKey && onSubmit) {
            event.preventDefault()
            onSubmit()
            return
          }
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            const selection = window.getSelection()
            if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode)) return
            const range = selection.getRangeAt(0)
            range.deleteContents()
            const newline = document.createTextNode('\n')
            range.insertNode(newline)
            moveCaretToTextNode(newline, 1)
            sync()
            return
          }
          if (
            event.key === 'Backspace' &&
            editorRef.current &&
            removeComposerTokenBeforeCaret(editorRef.current)
          ) {
            event.preventDefault()
            sync()
          }
        }}
      />
    </div>
  )
}

export default ComposerInputEditor
