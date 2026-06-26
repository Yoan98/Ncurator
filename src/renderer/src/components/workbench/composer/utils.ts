import type { ChatMessageContentNode, SelectedReference } from '../../../../../shared/types'
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
  const scopeMap = new Map<string, SelectedReference>()
  const seenScopeKeys = new Set<string>()
  const contentNodes: ChatMessageContentNode[] = []
  const input = nodes
    .filter((node): node is Extract<ComposerNode, { kind: 'text' }> => node.kind === 'text')
    .map((node) => node.text)
    .join('')
    .replace(/\u00a0/g, ' ')
    .trim()

  nodes.forEach((node) => {
    if (node.kind === 'text') {
      const text = node.text.replace(/\u00a0/g, ' ')
      if (text) contentNodes.push({ kind: 'text', text })
      return
    }
    const scopeKey = getScopeKey(node.scope)
    if (seenScopeKeys.has(scopeKey)) return
    seenScopeKeys.add(scopeKey)
    scopeMap.set(scopeKey, node.scope)
    contentNodes.push({ kind: 'reference', reference: node.scope })
  })

  const firstText = contentNodes.find((node) => node.kind === 'text')
  if (firstText?.kind === 'text') firstText.text = firstText.text.replace(/^\s+/, '')
  let lastText: ChatMessageContentNode | undefined
  for (let index = contentNodes.length - 1; index >= 0; index -= 1) {
    if (contentNodes[index].kind === 'text') {
      lastText = contentNodes[index]
      break
    }
  }
  if (lastText?.kind === 'text') lastText.text = lastText.text.replace(/\s+$/, '')
  const normalizedContentNodes = contentNodes.filter(
    (node) => node.kind !== 'text' || node.text.length > 0
  )

  return {
    input,
    contentNodes: normalizedContentNodes,
    selectedReferences: Array.from(scopeMap.values())
  }
}

export const createComposerNodesFromDraftValue = (draft: ComposerDraftValue): ComposerNode[] => {
  if (draft.contentNodes.length === 0) {
    return draft.input ? [createTextNode(draft.input)] : []
  }

  return normalizeComposerNodes(
    draft.contentNodes
      .map((node): ComposerNode | null => {
        if (node.kind === 'text') {
          return node.text ? createTextNode(node.text) : null
        }
        return createScopeNode(node.reference)
      })
      .filter((node): node is ComposerNode => Boolean(node))
  )
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
  const visualSpec = getReferenceVisualSpec(scope)
  const icon = document.createElement('span')
  icon.className = `inline-flex h-[1.15em] w-[1.15em] shrink-0 items-center justify-center ${visualSpec.iconClassName}`
  icon.dataset.referenceIconKind = visualSpec.kind

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute(
    'viewBox',
    visualSpec.kind === 'directory' || visualSpec.kind === 'web' ? '0 0 24 24' : '0 0 18 18'
  )
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', `h-[1em] w-[1em] ${visualSpec.iconClassName}`)

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
  token.className = `inline-flex max-w-full items-center gap-1 align-[-0.08em] text-[0.9em] font-medium leading-[inherit] ${visualSpec.labelClassName}`
  token.contentEditable = 'false'
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
