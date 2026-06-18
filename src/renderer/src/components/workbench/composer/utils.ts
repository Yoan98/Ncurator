import type { SelectedReference } from '../../../../../shared/types'
import type { ComposerDraftValue, ComposerNode } from './types'
import { getReferenceKey, pruneReferencesByWorkspace } from '../../../utils/reference'
import { getReferenceVisualKind, getReferenceVisualTone } from './referenceVisuals'

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
  const scopeMap = new Map<string, SelectedReference>()
  const input = nodes
    .filter((node): node is Extract<ComposerNode, { kind: 'text' }> => node.kind === 'text')
    .map((node) => node.text)
    .join('')
    .replace(/\u00a0/g, ' ')
    .trim()

  nodes.forEach((node) => {
    if (node.kind !== 'scope') return
    scopeMap.set(getScopeKey(node.scope), node.scope)
  })

  return {
    input,
    selectedReferences: Array.from(scopeMap.values())
  }
}

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
  const nextNodes: ComposerNode[] = []
  editor.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || ''
      if (!text) return
      nextNodes.push(createTextNode(text))
      return
    }

    if (!(child instanceof HTMLElement)) return
    if (child.dataset.role !== 'scope-token') return
    const scopeKey = String(child.dataset.scopeKey || '').trim()
    const scope = knownScopes.get(scopeKey)
    if (!scope) return
    nextNodes.push(createScopeNode(scope))
  })
  return normalizeComposerNodes(nextNodes)
}

const ICON_PATHS: Record<string, string> = {
  directory:
    'M2.25 6.75A2.25 2.25 0 014.5 4.5h3.879c.596 0 1.168.237 1.59.659l.872.872c.14.14.331.219.53.219H19.5a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-15A2.25 2.25 0 012.25 16.5V6.75z',
  web: 'M12 2.25a9.75 9.75 0 100 19.5 9.75 9.75 0 000-19.5zm0 0c2.25 2.25 3.375 5.25 3.375 9.75S14.25 19.5 12 21.75m0-19.5C9.75 4.5 8.625 7.5 8.625 12S9.75 19.5 12 21.75m-8.25-9.75h16.5',
  docx: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM13.5 2.5V8a1 1 0 001 1h5',
  pdf: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM8 15.5h8M8 18h5',
  file: 'M19.5 14.25v-5.4a2.25 2.25 0 00-.659-1.591l-4.1-4.1a2.25 2.25 0 00-1.591-.659H6.75A2.25 2.25 0 004.5 4.75v14.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-5zM13.5 2.5V8a1 1 0 001 1h5'
}

const appendReferenceIcon = (container: HTMLElement, scope: SelectedReference): void => {
  const visualKind = getReferenceVisualKind(scope)
  const tone = getReferenceVisualTone(scope)
  const icon = document.createElement('span')
  icon.className = `inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] ${tone.iconClassName}`
  icon.dataset.referenceIconKind = visualKind

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', `h-3.5 w-3.5 ${tone.iconClassName}`)

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICON_PATHS[visualKind])
  svg.appendChild(path)
  icon.appendChild(svg)
  container.appendChild(icon)
}

export const createScopeTokenElement = (scope: SelectedReference): HTMLElement => {
  const token = document.createElement('span')
  const tone = getReferenceVisualTone(scope)
  token.className = `mx-0.5 inline-flex max-w-full items-center gap-1 px-0.5 py-[1px] align-baseline text-[13px] font-medium leading-5 ${tone.iconClassName}`
  token.contentEditable = 'false'
  token.dataset.role = 'scope-token'
  token.dataset.scopeKey = getScopeKey(scope)

  appendReferenceIcon(token, scope)

  const label = document.createElement('span')
  label.className = 'max-w-[180px] truncate font-medium'
  label.textContent = scope.name
  token.appendChild(label)

  return token
}

export const renderComposerNodesToEditor = (editor: HTMLElement, nodes: ComposerNode[]): void => {
  editor.replaceChildren()
  nodes.forEach((node) => {
    if (node.kind === 'text') {
      editor.appendChild(document.createTextNode(node.text))
      return
    }
    editor.appendChild(createScopeTokenElement(node.scope))
  })
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
