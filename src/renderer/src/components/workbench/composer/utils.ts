import { t } from '../../../i18n'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReferenceIcon from './ReferenceIcon'
import { selectionTooltip } from '../../../../../shared/documentSelection'
import { chatContentText, chatReferences, selectionLabel } from '../../../../../shared/chatContent'
import type {
  ChatMessageContentNode,
  DocumentSelectionNode,
  SelectedReference
} from '../../../../../shared/types'
import type { ComposerDraftValue, ComposerNode } from './types'
import { getReferenceKey } from '../../../utils/reference'
import {
  INLINE_TOKEN_LABEL_CLASS_NAME,
  REFERENCE_TOKEN_CLASS_NAME,
  selectionIconPath,
  SELECTION_NUMBER_CLASS_NAME,
  SELECTION_TOKEN_CLASS_NAME,
  selectionFileName
} from './referenceVisuals'

/**
 * Invisible text host for programmatic carets. Chromium anchors an IME composition at the
 * exact DOM boundary where it starts; a caret on an element boundary after a <br>/token, or in
 * an empty text node, commits the first preedit as raw letters. The placeholder is never part
 * of the draft, but it keeps the caret inside a text node until real input arrives.
 *
 * A run of four U+200B distinguishes our host from a single zero-width character the user
 * pastes or types; only the run is stripped, so the user's own invisible character stays input.
 */
const CARET_TEXT_PLACEHOLDER = '\u200b\u200b\u200b\u200b'
const CARET_TEXT_PLACEHOLDER_PATTERN = /\u200b{4}/g
const caretPlaceholderNodes = new WeakSet<Text>()

const createCaretPlaceholderNode = (): Text => {
  const node = document.createTextNode(CARET_TEXT_PLACEHOLDER)
  caretPlaceholderNodes.add(node)
  return node
}

const markCaretPlaceholderNode = (node: Text): Text => {
  caretPlaceholderNodes.add(node)
  if (!node.data) node.data = CARET_TEXT_PLACEHOLDER
  return node
}

const isPlaceholderOnlyText = (node: Node | null): node is Text =>
  node instanceof Text &&
  caretPlaceholderNodes.has(node) &&
  !node.data.replace(CARET_TEXT_PLACEHOLDER_PATTERN, '')

const readCaretText = (node: Text): string =>
  caretPlaceholderNodes.has(node)
    ? node.data.replace(CARET_TEXT_PLACEHOLDER_PATTERN, '')
    : node.data

const caretEndOffset = (node: Text): number => {
  if (!caretPlaceholderNodes.has(node)) return node.data.length
  const placeholderIndex = node.data.lastIndexOf(CARET_TEXT_PLACEHOLDER)
  return placeholderIndex >= 0 ? placeholderIndex : node.data.length
}

const isCaretAnchorElement = (node: Node | null): node is HTMLElement =>
  node instanceof HTMLElement && node.dataset.role === 'composer-caret-anchor'

const firstContentText = (node: Node | null): Text | null =>
  node instanceof Text && node.data.length > 0 ? node : null

const createTextNode = (text = ''): ComposerNode => ({
  id: crypto.randomUUID(),
  kind: 'text',
  text
})

const createScopeNode = (scope: SelectedReference): ComposerNode => ({
  id: crypto.randomUUID(),
  kind: 'scope',
  scope
})

export const getScopeKey = (scope: SelectedReference): string => getReferenceKey(scope)

/** Editor content includes whitespace; send validation separately requires user text. */
export const hasComposerContent = (
  nodes: readonly (ComposerNode | ChatMessageContentNode)[]
): boolean => nodes.some((node) => node.kind !== 'text' || node.text.length > 0)

const normalizeComposerNodes = (nodes: ComposerNode[]): ComposerNode[] => {
  const nextNodes: ComposerNode[] = []
  nodes.forEach((node) => {
    if (node.kind === 'text') {
      if (!node.text) return
      const previous = nextNodes[nextNodes.length - 1]
      if (previous?.kind === 'text') {
        previous.text += node.text
        return
      }
    }
    nextNodes.push(node)
  })
  return nextNodes
}

/** Numbers belong to the current draft; stable selection IDs carry the association. */
export const renumberComposerSelections = (draft: ComposerDraftValue): ComposerDraftValue => {
  const numbers = new Map<string, number>()
  let changed = false
  const contentNodes = draft.contentNodes.map((node) => {
    if (node.kind !== 'document_selection') return node
    const number = (numbers.get(node.filePath) || 0) + 1
    numbers.set(node.filePath, number)
    if (node.number === number) return node
    changed = true
    return { ...node, number }
  })
  return changed ? { ...draft, contentNodes, input: chatContentText(contentNodes) } : draft
}

export const extractComposerDraftValue = (nodes: ComposerNode[]): ComposerDraftValue => {
  const contentNodes: ChatMessageContentNode[] = nodes.map((node) => {
    if (node.kind === 'text') return { kind: 'text', text: node.text.replace(/\u00a0/g, ' ') }
    if (node.kind === 'scope') return { kind: 'reference', reference: node.scope }
    return node.selection
  })
  return renumberComposerSelections({
    input: chatContentText(contentNodes),
    contentNodes,
    selectedReferences: chatReferences(contentNodes),
    attachments: []
  })
}

export const createComposerNodesFromDraftValue = (draft: ComposerDraftValue): ComposerNode[] =>
  normalizeComposerNodes(
    draft.contentNodes.map((node): ComposerNode => {
      if (node.kind === 'text') return createTextNode(node.text)
      if (node.kind === 'reference') return createScopeNode(node.reference)
      return { id: node.id, kind: 'selection', selection: node }
    })
  )

const selectionElements = new WeakMap<HTMLElement, DocumentSelectionNode>()
const referenceElements = new WeakMap<HTMLElement, SelectedReference>()

const updateSelectionToken = (token: HTMLElement, selection: DocumentSelectionNode): void => {
  token.title = selectionLabel(selection) + '\n' + selectionTooltip(selection)
  token.setAttribute('aria-label', selectionLabel(selection))
  const number = token.querySelector('[data-role="selection-number"]')
  if (number) number.textContent = String(selection.number)
}

/** Refresh atomic token visuals and metadata without replacing editable content or the caret. */
export const syncComposerTokens = (
  editor: HTMLElement,
  contentNodes: ChatMessageContentNode[],
  onOpenFile?: (file: Extract<SelectedReference, { kind: 'file' }>) => void
): void => {
  const references = new Map(
    chatReferences(contentNodes).map((scope) => [getScopeKey(scope), scope])
  )
  for (const token of editor.querySelectorAll<HTMLElement>('[data-role="scope-token"]')) {
    const scope = references.get(token.dataset.scopeKey || '') || referenceElements.get(token)
    if (!scope) continue
    referenceElements.set(token, scope)
    const openable = scope.kind === 'file' && Boolean(onOpenFile)
    token.className =
      REFERENCE_TOKEN_CLASS_NAME + (openable ? ' cursor-pointer hover:underline' : '')
    if (scope.kind === 'file' && onOpenFile) {
      token.setAttribute('role', 'button')
      token.tabIndex = 0
      token.onmousedown = (event) => event.preventDefault()
      token.onclick = () => onOpenFile(scope)
      token.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        token.click()
      }
    } else {
      token.removeAttribute('role')
      token.removeAttribute('tabindex')
      token.onmousedown = token.onclick = token.onkeydown = null
    }
    const markup = referenceIconMarkup(scope)
    const icon = token.firstElementChild
    if (icon?.outerHTML === markup) continue
    const template = document.createElement('template')
    template.innerHTML = markup
    if (icon) icon.replaceWith(template.content)
    else token.prepend(template.content)
  }
  const selections = new Map(
    contentNodes.filter((node) => node.kind === 'document_selection').map((node) => [node.id, node])
  )
  for (const fragment of editor.querySelectorAll<HTMLElement>(
    '[data-role="document-selection-fragment"]'
  )) {
    const selection = selections.get(fragment.dataset.selectionId || '')
    const token = fragment.querySelector<HTMLElement>('[data-role="document-selection-token"]')
    if (!selection || !token) continue
    selectionElements.set(fragment, selection)
    updateSelectionToken(token, selection)
  }
}

export const readComposerNodesFromEditor = (
  editor: HTMLElement,
  knownScopes: Map<string, SelectedReference>
): ComposerNode[] => {
  const read = (parent: HTMLElement): ComposerNode[] => {
    const nodes: ComposerNode[] = []
    parent.childNodes.forEach((child) => {
      if (child instanceof Text) {
        const text = readCaretText(child)
        if (text) nodes.push(createTextNode(text))
        return
      }
      if (!(child instanceof HTMLElement)) return
      if (
        child.dataset.role === 'document-selection-token' ||
        child.dataset.role === 'composer-caret-anchor'
      )
        return
      if (child.dataset.role === 'document-selection-fragment') {
        const selection = selectionElements.get(child)
        if (!selection) return
        if (!child.querySelector('[data-role="document-selection-token"]')) {
          child.remove()
          return
        }
        const children = extractComposerDraftValue(read(child)).contentNodes.filter(
          (node) => node.kind !== 'document_selection'
        )
        nodes.push({ id: selection.id, kind: 'selection', selection: { ...selection, children } })
        return
      }
      if (child.dataset.role === 'scope-token') {
        const scope = referenceElements.get(child) || knownScopes.get(child.dataset.scopeKey || '')
        if (scope) nodes.push(createScopeNode(scope))
        return
      }
      if (child instanceof HTMLBRElement) nodes.push(createTextNode('\n'))
      else {
        const children = read(child)
        if (!children.length) return
        if (['DIV', 'P'].includes(child.tagName) && nodes.length) nodes.push(createTextNode('\n'))
        nodes.push(...children)
      }
    })
    return normalizeComposerNodes(nodes)
  }
  return read(editor)
}

const referenceIconMarkup = (scope: SelectedReference): string =>
  renderToStaticMarkup(createElement(ReferenceIcon, { reference: scope, size: 'inline' }))

const appendReferenceIcon = (container: HTMLElement, scope: SelectedReference): void => {
  const template = document.createElement('template')
  template.innerHTML = referenceIconMarkup(scope)
  container.appendChild(template.content)
}

export const createScopeTokenElement = (scope: SelectedReference): HTMLElement => {
  const token = document.createElement('span')
  token.className = REFERENCE_TOKEN_CLASS_NAME
  token.contentEditable = 'false'
  token.title = scope.name
  referenceElements.set(token, scope)
  token.dataset.role = 'scope-token'
  token.dataset.scopeKey = getScopeKey(scope)

  appendReferenceIcon(token, scope)

  const label = document.createElement('span')
  label.className = INLINE_TOKEN_LABEL_CLASS_NAME
  label.textContent = scope.name
  token.appendChild(label)

  const suffix = document.createElement('span')
  suffix.className = 'sr-only'
  suffix.textContent =
    scope.kind === 'web'
      ? t(($) => $.workbench.webLink)
      : scope.kind === 'directory'
        ? t(($) => $.workbench.directoryLink)
        : t(($) => $.workbench.fileLink)
  token.appendChild(suffix)

  return token
}

export const renderComposerNodesToEditor = (editor: HTMLElement, nodes: ComposerNode[]): void => {
  editor.replaceChildren()
  nodes.forEach((node) => {
    if (node.kind === 'text') editor.appendChild(document.createTextNode(node.text))
    else if (node.kind === 'scope') editor.appendChild(createScopeTokenElement(node.scope))
    else {
      const fragment = document.createElement('span')
      fragment.dataset.role = 'document-selection-fragment'
      fragment.dataset.selectionId = node.selection.id
      selectionElements.set(fragment, node.selection)
      const token = document.createElement('span')
      token.contentEditable = 'false'
      token.dataset.role = 'document-selection-token'
      token.dataset.selectionId = node.selection.id
      token.className = SELECTION_TOKEN_CLASS_NAME
      token.setAttribute('role', 'button')
      token.tabIndex = 0
      token.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        token.click()
      })
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      icon.setAttribute('viewBox', '0 0 18 18')
      icon.setAttribute('fill', 'none')
      icon.setAttribute('stroke', 'currentColor')
      icon.setAttribute('stroke-width', '1.4')
      icon.setAttribute('stroke-linecap', 'round')
      icon.setAttribute('stroke-linejoin', 'round')
      icon.setAttribute('aria-hidden', 'true')
      icon.setAttribute('class', 'relative top-[0.1em] h-[1em] w-[1em] shrink-0 self-center')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', selectionIconPath(node.selection))
      icon.appendChild(path)
      const label = document.createElement('span')
      label.className = INLINE_TOKEN_LABEL_CLASS_NAME
      label.textContent = selectionFileName(node.selection)
      const number = document.createElement('span')
      number.dataset.role = 'selection-number'
      number.className = SELECTION_NUMBER_CLASS_NAME
      token.append(icon, label, number)
      updateSelectionToken(token, node.selection)
      fragment.appendChild(token)
      const thought = document.createElement('span')
      thought.dataset.role = 'document-selection-thought'
      renderComposerNodesToEditor(
        thought,
        createComposerNodesFromDraftValue({
          input: '',
          contentNodes: node.selection.children,
          selectedReferences: [],
          attachments: []
        })
      )
      fragment.appendChild(thought)
      editor.appendChild(fragment)
    }
  })
}

/** Atomic tokens share the same deletion behavior, including tokens nested in a selection. */
export const removeComposerTokenAtCaret = (
  editor: HTMLElement,
  direction: 'backward' | 'forward'
): boolean => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode))
    return false
  const backward = direction === 'backward'
  const adjacent = (node: Node): Node | null => {
    let current: Node | null = node
    while (current && current !== editor) {
      const sibling = backward ? current.previousSibling : current.nextSibling
      if (sibling) return sibling
      current = current.parentNode
    }
    return null
  }
  let anchor = selection.anchorNode
  if (anchor instanceof Text) {
    if (selection.anchorOffset !== (backward ? 0 : anchor.data.length)) return false
    anchor = adjacent(anchor)
  } else if (anchor instanceof HTMLElement) {
    const index = selection.anchorOffset - (backward ? 1 : 0)
    anchor = anchor.childNodes[index] || adjacent(anchor)
  }
  const roles = ['scope-token', 'document-selection-token', 'document-selection-fragment']
  while (anchor) {
    if (anchor instanceof Text) {
      if (anchor.data) return false
      anchor = adjacent(anchor)
    } else if (anchor instanceof HTMLElement && !roles.includes(anchor.dataset.role || '')) {
      if (anchor instanceof HTMLBRElement && anchor.dataset.role !== 'composer-caret-anchor')
        return false
      anchor = (backward ? anchor.lastChild : anchor.firstChild) || adjacent(anchor)
    } else break
  }
  if (!(anchor instanceof HTMLElement) || !roles.includes(anchor.dataset.role || '')) return false
  const target =
    anchor.dataset.role === 'document-selection-token'
      ? anchor.closest<HTMLElement>('[data-role="document-selection-fragment"]')
      : anchor
  const parent = target?.parentNode
  if (!target || !parent) return false
  const index = Array.from(parent.childNodes).indexOf(target)
  target.remove()
  const range = document.createRange()
  range.setStart(parent, index)
  range.collapse(true)
  resolveCaretRange(editor, range)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

export const moveCaretToTextNode = (textNode: Text, offset: number): void => {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStart(textNode, Math.max(0, Math.min(offset, textNode.data.length)))
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Real editor text: our caret host is skipped, a user-entered zero-width character counts. */
export const editorHasVisibleText = (editor: HTMLElement): boolean => {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    if (readCaretText(walker.currentNode as Text)) return true
  }
  return false
}

/**
 * Chromium anchors an IME composition at the DOM boundary where it starts. Keep a collapsed
 * caret inside a non-empty text node: a boundary after a <br>/token, or an empty text node,
 * commits the first preedit as raw letters. A placeholder text node is only inserted when the
 * caret has no editable text to land in.
 */
export const resolveCaretRange = (editor: HTMLElement, range: Range): void => {
  if (!range.collapsed) return
  const container = range.startContainer
  if (container !== editor && !editor.contains(container)) return
  const containerElement =
    container instanceof Text
      ? container.parentElement
      : container instanceof HTMLElement
        ? container
        : null
  if (containerElement?.closest('[contenteditable="false"]')) return

  const collapseTo = (node: Text, offset: number): void => {
    range.setStart(node, Math.max(0, Math.min(offset, node.data.length)))
    range.collapse(true)
  }

  if (container instanceof Text) {
    if (readCaretText(container)) return
    const previous = firstContentText(container.previousSibling)
    if (previous) return collapseTo(previous, caretEndOffset(previous))
    const next = firstContentText(container.nextSibling)
    if (next) return collapseTo(next, 0)
    markCaretPlaceholderNode(container)
    return collapseTo(container, 0)
  }

  if (!(container instanceof HTMLElement)) return
  const offset = range.startOffset
  const previousNode = container.childNodes[offset - 1] || null
  const nextNode = container.childNodes[offset] || null
  const previous = firstContentText(previousNode)
  if (previous) return collapseTo(previous, caretEndOffset(previous))
  const next = firstContentText(nextNode)
  if (next) return collapseTo(next, 0)
  // Before the first child is a native-safe IME position; keep it instead of adding a host.
  if (offset === 0) return
  if (previousNode instanceof Text) {
    markCaretPlaceholderNode(previousNode)
    return collapseTo(previousNode, 0)
  }
  if (nextNode instanceof Text) {
    markCaretPlaceholderNode(nextNode)
    return collapseTo(nextNode, 0)
  }
  const holder = createCaretPlaceholderNode()
  container.insertBefore(holder, nextNode)
  collapseTo(holder, 0)
}

/** Move the current selection back into a text node when it sits on an IME-hostile boundary. */
export const anchorCaretInTextNode = (editor: HTMLElement): void => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  const container = range.startContainer
  const offset = range.startOffset
  resolveCaretRange(editor, range)
  if (range.startContainer === container && range.startOffset === offset) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Drop placeholder hosts once the draft has no content; an empty editor's offset 0 is IME-safe. */
export const clearCaretPlaceholders = (editor: HTMLElement): void => {
  const placeholders: Text[] = []
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    if (isPlaceholderOnlyText(walker.currentNode)) placeholders.push(walker.currentNode)
  }
  if (placeholders.length === 0) return
  const selection = window.getSelection()
  const selectionInside = Boolean(
    selection?.anchorNode && placeholders.some((node) => node === selection.anchorNode)
  )
  placeholders.forEach((node) => node.remove())
  if (!selection || (!selectionInside && document.activeElement !== editor)) return
  const range = document.createRange()
  range.setStart(editor, 0)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Real input arrived next to a caret host: strip the host run so it never shows in innerText/copy. */
export const stripCaretPlaceholderChars = (editor: HTMLElement): void => {
  const placeholders: Text[] = []
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text && caretPlaceholderNodes.has(node)) placeholders.push(node)
  }
  if (placeholders.length === 0) return
  const selection = window.getSelection()
  placeholders.forEach((node) => {
    if (!node.data.replace(CARET_TEXT_PLACEHOLDER_PATTERN, '')) {
      if (selection?.anchorNode !== node) node.remove()
      return
    }
    // deleteData keeps the live Selection offset (assigning data resets it to 0).
    let index = node.data.lastIndexOf(CARET_TEXT_PLACEHOLDER)
    while (index >= 0) {
      node.deleteData(index, CARET_TEXT_PLACEHOLDER.length)
      index = node.data.lastIndexOf(CARET_TEXT_PLACEHOLDER, index - 1)
    }
  })
}

export const moveCaretToEnd = (editor: HTMLElement): void => {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()

  let content: Node | null = null
  for (let node = editor.lastChild; node; node = node.previousSibling) {
    if (isCaretAnchorElement(node)) continue
    if (node instanceof Text && !node.data) continue
    content = node
    break
  }

  if (!content) {
    // Empty editor: before any trailing caret anchor, matching a native click.
    range.setStart(editor, 0)
    range.collapse(true)
  } else if (content instanceof Text) {
    // Stay inside the last text node rather than on the boundary after a trailing <br>.
    range.setStart(content, caretEndOffset(content))
    range.collapse(true)
  } else {
    // A token is the last content: caret anchors after it are not text the IME can compose in.
    let trailing = editor.lastChild
    while (isCaretAnchorElement(trailing)) {
      trailing.remove()
      trailing = editor.lastChild
    }
    const holder = createCaretPlaceholderNode()
    editor.appendChild(holder)
    range.setStart(holder, 0)
    range.collapse(true)
  }

  selection.removeAllRanges()
  selection.addRange(range)
}
