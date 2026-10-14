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
  contentNodes: ChatMessageContentNode[]
): void => {
  const references = new Map(
    chatReferences(contentNodes).map((scope) => [getScopeKey(scope), scope])
  )
  for (const token of editor.querySelectorAll<HTMLElement>('[data-role="scope-token"]')) {
    const scope = references.get(token.dataset.scopeKey || '') || referenceElements.get(token)
    if (!scope) continue
    referenceElements.set(token, scope)
    token.className = REFERENCE_TOKEN_CLASS_NAME
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
        if (child.data) nodes.push(createTextNode(child.data))
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
    scope.kind === 'web' ? '网页链接' : scope.kind === 'directory' ? '目录链接' : '文件链接'
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

export const moveCaretToEnd = (editor: HTMLElement): void => {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}
