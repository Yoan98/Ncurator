import { chatContentText, chatReferences } from '../../../../../shared/chatContent'
import type {
  ChatMessageContentNode,
  DocumentSelectionNode,
  SelectedReference
} from '../../../../../shared/types'
import type { ComposerDraftValue, ComposerNode } from './types'
import { getReferenceKey, pruneReferencesByWorkspace } from '../../../utils/reference'
import { getReferenceVisualSpec } from './referenceVisuals'

export const createTextNode = (text = ''): ComposerNode => ({
  id: crypto.randomUUID(),
  kind: 'text',
  text
})

export const createScopeNode = (scope: SelectedReference): ComposerNode => ({
  id: crypto.randomUUID(),
  kind: 'scope',
  scope
})

export const getScopeKey = (scope: SelectedReference): string => getReferenceKey(scope)

export const normalizeComposerNodes = (nodes: ComposerNode[]): ComposerNode[] => {
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

export const extractComposerDraftValue = (nodes: ComposerNode[]): ComposerDraftValue => {
  const contentNodes: ChatMessageContentNode[] = nodes.map((node) => {
    if (node.kind === 'text') return { kind: 'text', text: node.text.replace(/\u00a0/g, ' ') }
    if (node.kind === 'scope') return { kind: 'reference', reference: node.scope }
    return node.selection
  })
  return {
    input: chatContentText(contentNodes).trim(),
    contentNodes,
    selectedReferences: chatReferences(contentNodes),
    attachments: []
  }
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

export const pruneComposerNodesByWorkspace = (
  nodes: ComposerNode[],
  workspaceId: string | null
): ComposerNode[] =>
  normalizeComposerNodes(
    nodes.filter((node) => {
      if (node.kind !== 'scope') return true
      return pruneReferencesByWorkspace([node.scope], workspaceId).length > 0
    })
  )

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
        if (['DIV', 'P'].includes(child.tagName) && nodes.length) nodes.push(createTextNode('\n'))
        nodes.push(...read(child))
      }
    })
    return normalizeComposerNodes(nodes)
  }
  return read(editor)
}

const appendReferenceIcon = (container: HTMLElement, scope: SelectedReference): void => {
  const visualSpec = getReferenceVisualSpec(scope)
  const icon = document.createElement('span')
  icon.className = `relative top-[0.1em] inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center ${visualSpec.iconClassName}`
  icon.dataset.referenceIconKind = visualSpec.kind

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute(
    'viewBox',
    visualSpec.kind === 'directory' || visualSpec.kind === 'web' ? '0 0 24 24' : '0 0 18 18'
  )
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', `h-[0.9em] w-[0.9em] ${visualSpec.iconClassName}`)

  if (visualSpec.kind === 'directory' || visualSpec.kind === 'web') {
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    const paths =
      visualSpec.kind === 'directory'
        ? [
            'M3.5 6.5h5.15l1.45 1.65h10.4v8.9c0 .8-.65 1.45-1.45 1.45H4.95c-.8 0-1.45-.65-1.45-1.45V6.5z'
          ]
        : [
            'M3.5 12h17',
            'M12 3.5c2.15 2.2 3.2 5.05 3.2 8.5s-1.05 6.3-3.2 8.5M12 3.5C9.85 5.7 8.8 8.55 8.8 12s1.05 6.3 3.2 8.5'
          ]
    if (visualSpec.kind === 'web') {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('cx', '12')
      circle.setAttribute('cy', '12')
      circle.setAttribute('r', '8.5')
      svg.appendChild(circle)
    }
    paths.forEach((item) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', item)
      svg.appendChild(path)
    })
  } else {
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    background.setAttribute(
      'd',
      'M4.3 1.7h6.5l3.1 3.1v10.4c0 .7-.6 1.2-1.2 1.2H4.3c-.7 0-1.2-.6-1.2-1.2V2.9c0-.7.5-1.2 1.2-1.2z'
    )
    background.setAttribute('class', visualSpec.documentFillClassName)
    svg.appendChild(background)
    if (!visualSpec.documentLabel) {
      const sheet = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      sheet.setAttribute('d', 'M4.3 2.7h6.1l2.5 2.5v10.1H4.3V2.7z')
      sheet.setAttribute('class', 'fill-white')
      svg.appendChild(sheet)
    }
    const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    fold.setAttribute('d', 'M10.4 1.7v3.4h3.5l-3.5-3.4z')
    fold.setAttribute('class', visualSpec.documentAccentClassName)
    svg.appendChild(fold)
    if (visualSpec.documentLabel) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      label.setAttribute('x', '8.55')
      label.setAttribute('y', '11.2')
      label.setAttribute('class', 'fill-white')
      label.setAttribute('dominant-baseline', 'middle')
      label.setAttribute('font-family', 'Arial, sans-serif')
      label.setAttribute('font-size', '4')
      label.setAttribute('font-weight', '700')
      label.setAttribute('text-anchor', 'middle')
      label.textContent = visualSpec.documentLabel
      svg.appendChild(label)
    } else {
      const lines = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      lines.setAttribute('d', 'M6 7.2h5.1v1.2H6zM6 9.4h5.1v1.2H6zM6 11.6h3.6v1.2H6z')
      lines.setAttribute('class', visualSpec.documentAccentClassName)
      svg.appendChild(lines)
    }
  }
  icon.appendChild(svg)
  container.appendChild(icon)
}

export const createScopeTokenElement = (scope: SelectedReference): HTMLElement => {
  const visualSpec = getReferenceVisualSpec(scope)
  const token = document.createElement('span')
  token.className = `inline-flex max-w-full items-baseline gap-[2px] align-baseline text-[0.9em] font-medium leading-[inherit] ${visualSpec.labelClassName}`
  token.contentEditable = 'false'
  referenceElements.set(token, scope)
  token.dataset.role = 'scope-token'
  token.dataset.scopeKey = getScopeKey(scope)

  appendReferenceIcon(token, scope)

  const label = document.createElement('span')
  label.className = 'max-w-[180px] truncate font-medium'
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
      token.className = 'cursor-pointer text-[0.9em] font-medium text-[#2F5F8F]'
      token.style.marginRight = '0.25em'
      token.textContent = `[${node.selection.filePath.split(/[/\\]/).pop()} · ${node.selection.number}]`
      token.title = node.selection.selectedText
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
export const removeComposerTokenBeforeCaret = (editor: HTMLElement): boolean => {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode))
    return false
  let anchor = selection.anchorNode
  if (!anchor || selection.anchorOffset !== 0) {
    if (!(anchor instanceof HTMLElement) || selection.anchorOffset < 1) return false
    anchor = anchor.childNodes[selection.anchorOffset - 1] || null
  } else {
    while (anchor && anchor !== editor && !anchor.previousSibling) anchor = anchor.parentNode
    anchor = anchor?.previousSibling || null
  }
  if (
    !(anchor instanceof HTMLElement) ||
    !['scope-token', 'document-selection-token', 'document-selection-fragment'].includes(
      anchor.dataset.role || ''
    )
  )
    return false
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
