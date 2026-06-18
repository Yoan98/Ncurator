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

const appendReferenceIcon = (container: HTMLElement, scope: SelectedReference): void => {
  const visualKind = getReferenceVisualKind(scope)
  const tone = getReferenceVisualTone(scope)
  const icon = document.createElement('span')
  icon.className = `inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center ${tone.iconClassName}`
  icon.dataset.referenceIconKind = visualKind

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute(
    'viewBox',
    visualKind === 'directory' || visualKind === 'web' ? '0 0 24 24' : '0 0 18 18'
  )
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', `h-3.5 w-3.5 ${tone.iconClassName}`)

  if (visualKind === 'directory' || visualKind === 'web') {
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    const paths =
      visualKind === 'directory'
        ? [
            'M3.5 6.5h5.15l1.45 1.65h10.4v8.9c0 .8-.65 1.45-1.45 1.45H4.95c-.8 0-1.45-.65-1.45-1.45V6.5z'
          ]
        : [
            'M3.5 12h17',
            'M12 3.5c2.15 2.2 3.2 5.05 3.2 8.5s-1.05 6.3-3.2 8.5M12 3.5C9.85 5.7 8.8 8.55 8.8 12s1.05 6.3 3.2 8.5'
          ]
    if (visualKind === 'web') {
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
    background.setAttribute('class', tone.fillClassName)
    svg.appendChild(background)
    const fold = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    fold.setAttribute('d', 'M10.4 1.7v3.4h3.5l-3.5-3.4z')
    fold.setAttribute('class', visualKind === 'file' ? tone.textClassName : 'fill-white/70')
    svg.appendChild(fold)
    if (visualKind === 'pdf') {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', '9')
      text.setAttribute('y', '11.4')
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('font-family', 'Arial, sans-serif')
      text.setAttribute('font-size', '4')
      text.setAttribute('font-weight', '700')
      text.setAttribute('class', tone.textClassName)
      text.textContent = 'PDF'
      svg.appendChild(text)
    } else {
      const lines = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      lines.setAttribute(
        'd',
        visualKind === 'docx'
          ? 'M6 7.1h5.9v1.2H6zM6 9.1h5.9v1.2H6zM6 11.1h4.2v1.2H6z'
          : 'M6 7.2h5.1v1.2H6zM6 9.4h5.1v1.2H6zM6 11.6h3.6v1.2H6z'
      )
      lines.setAttribute('class', visualKind === 'docx' ? 'fill-white' : tone.textClassName)
      svg.appendChild(lines)
    }
  }
  icon.appendChild(svg)
  container.appendChild(icon)
}

export const createScopeTokenElement = (scope: SelectedReference): HTMLElement => {
  const token = document.createElement('span')
  const tone = getReferenceVisualTone(scope)
  token.className = `inline-flex max-w-full items-center gap-0.5 px-0 py-[1px] align-baseline text-[13px] font-medium leading-5 ${tone.iconClassName}`
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
