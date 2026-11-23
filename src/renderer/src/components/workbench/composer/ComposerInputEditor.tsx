import React, { useEffect, useRef } from 'react'
import type { SelectedReference } from '../../../../../shared/types'
import ReferenceMentionPanel from './ReferenceMentionPanel'
import { useReferenceMention } from './useReferenceMention'
import type { ComposerDraftValue } from './types'
import {
  anchorCaretInTextNode,
  clearCaretPlaceholders,
  createComposerNodesFromDraftValue,
  createScopeTokenElement,
  extractComposerDraftValue,
  getScopeKey,
  hasComposerContent,
  moveCaretToEnd,
  moveCaretToTextNode,
  readComposerNodesFromEditor,
  removeComposerTokenAtCaret,
  renderComposerNodesToEditor,
  resolveCaretRange,
  stripCaretPlaceholderChars
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
  variant?: 'field' | 'inline'
}
type MentionContext = { textNode: Text; caretOffset: number; triggerIndex: number; query: string }

const isTextNode = (value: Node | null): value is Text => value instanceof Text

const ComposerInputEditor: React.FC<Props> = ({
  value,
  onChange,
  placeholder,
  dataTestId,
  editorClassName,
  variant = 'field',
  disabled = false,
  onSubmit
}) => {
  const { input, contentNodes, selectedReferences } = value
  const composingRef = useRef(false)
  const compositionEndedAtRef = useRef(0)
  const editorRef = useRef<HTMLSpanElement | null>(null)
  const knownScopesRef = useRef(new Map<string, SelectedReference>())
  const lastEmittedSignatureRef = useRef<string | null>(null)
  const {
    state: mention,
    getCurrent: getCurrentMention,
    search: searchMention,
    close: closeMention,
    loadMore: loadMoreMention,
    move: moveMention,
    canSelect: canSelectMention
  } = useReferenceMention()

  const refreshMention = (): void => {
    const context = mentionContext()
    if (!context) {
      closeMention()
      return
    }
    searchMention(context.query)
  }

  const sync = (): void => {
    const editor = editorRef.current
    if (!editor) return
    const nodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    if (hasComposerContent(nodes)) {
      stripCaretPlaceholderChars(editor)
      anchorCaretInTextNode(editor)
    } else {
      clearCaretPlaceholders(editor)
    }
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
    closeMention()
    const nodes = createComposerNodesFromDraftValue({
      input,
      contentNodes,
      selectedReferences,
      attachments: []
    })
    nodes.forEach((node) => {
      if (node.kind === 'scope') knownScopesRef.current.set(getScopeKey(node.scope), node.scope)
    })
    const editor = editorRef.current
    if (editor) {
      renderComposerNodesToEditor(editor, nodes)
      if (document.activeElement === editor) moveCaretToEnd(editor)
    }
    lastEmittedSignatureRef.current = signature
  }, [closeMention, contentNodes, input, selectedReferences])

  const insertMention = (reference: SelectedReference): void => {
    const context = mentionContext()
    const editor = editorRef.current
    if (!context || !editor || !context.textNode.parentNode || !canSelectMention(context.query))
      return
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
    closeMention()
    sync()
  }

  return (
    <div className={`relative ${variant === 'inline' ? 'min-w-0 flex-1' : ''}`}>
      {mention.query !== null ? (
        <ReferenceMentionPanel {...mention} onSelect={insertMention} onLoadMore={loadMoreMention} />
      ) : null}
      <span
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-testid={dataTestId}
        data-placeholder={placeholder}
        className={`block whitespace-pre-wrap break-words text-[var(--notion-text)] outline-none empty:before:pointer-events-none empty:before:text-[var(--notion-text-faint)] empty:before:content-[attr(data-placeholder)] ${variant === 'inline' ? 'min-h-[28px] px-2 py-[4px] text-[13px] leading-[20px]' : 'min-h-[72px] rounded-[6px] border border-[var(--notion-line-strong)] px-3 py-2 text-[14px] leading-6'} ${editorClassName || ''}`}
        onInput={() => {
          if (composingRef.current) return
          editorRef.current
            ?.querySelectorAll('[data-role="composer-caret-anchor"]')
            .forEach((anchor) => anchor.remove())
          sync()
        }}
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
          if (getCurrentMention().query !== null) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              moveMention(event.key === 'ArrowDown' ? 1 : -1)
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const { options, activeIndex } = getCurrentMention()
              const option = options[activeIndex]
              if (option) insertMention(option)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              closeMention()
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
            const editor = editorRef.current
            const selection = window.getSelection()
            if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return
            const range = selection.getRangeAt(0)
            range.deleteContents()
            const newline = document.createElement('br')
            range.insertNode(newline)
            range.setStartAfter(newline)
            range.collapse(true)
            // A caret after a <br> is on an element boundary; give the IME a text node to compose in.
            resolveCaretRange(editor, range)
            selection.removeAllRanges()
            selection.addRange(range)
            sync()
            return
          }
          if (
            event.key === 'Backspace' &&
            editorRef.current &&
            removeComposerTokenAtCaret(editorRef.current, 'backward')
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
