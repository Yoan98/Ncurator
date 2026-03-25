import type { SourceScopeSelection } from '../../../../../shared/types'
import { TOKEN_BADGE_CLASSNAME, TOKEN_TONE_CLASSNAME } from './constants'
import type { ComposerDraftValue, ComposerNode } from './types'

export const createTextNode = (text = ''): ComposerNode => ({
  id: crypto.randomUUID(),
  kind: 'text',
  text
})

export const createScopeNode = (scope: SourceScopeSelection): ComposerNode => ({
  id: crypto.randomUUID(),
  kind: 'scope',
  scope
})

export const getScopeKey = (scope: SourceScopeSelection): string =>
  [scope.sourceType, scope.sourceId, scope.scopeType, scope.nodeId || 'root'].join(':')

export const getScopeBadgeLabel = (scope: SourceScopeSelection): string => {
  if (scope.scopeType === 'workspace') return 'WS'
  if (scope.scopeType === 'directory') return 'DIR'
  if (scope.scopeType === 'web') return 'WEB'
  const ext = scope.relativePath?.split('.').pop()?.trim()
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE'
}

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
  const scopeMap = new Map<string, SourceScopeSelection>()
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
    selectedSourceScopes: Array.from(scopeMap.values())
  }
}

export const pruneComposerNodesByWorkspace = (
  nodes: ComposerNode[],
  workspaceId: string | null
): ComposerNode[] =>
  normalizeComposerNodes(
    nodes.filter((node) => {
      if (node.kind !== 'scope') return true
      if (node.scope.sourceType !== 'workspace') return true
      return Boolean(workspaceId) && node.scope.sourceId === workspaceId
    })
  )

export const readComposerNodesFromEditor = (
  editor: HTMLElement,
  knownScopes: Map<string, SourceScopeSelection>
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

const appendBadge = (container: HTMLElement, label: string, className: string): void => {
  const badge = document.createElement('span')
  badge.className = `inline-flex h-4 min-w-4 items-center justify-center rounded-md px-1 text-[9px] font-semibold tracking-[0.08em] ${className}`
  badge.textContent = label
  container.appendChild(badge)
}

const appendRemoveButton = (container: HTMLElement): void => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none text-current/70 transition hover:bg-black/5 hover:text-current'
  button.setAttribute('aria-label', '移除资料标签')
  button.dataset.action = 'remove-scope-token'
  button.textContent = '×'
  container.appendChild(button)
}

export const createScopeTokenElement = (scope: SourceScopeSelection): HTMLElement => {
  const token = document.createElement('span')
  token.className = `mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-0.5 align-baseline text-[13px] leading-5 ${TOKEN_TONE_CLASSNAME[scope.scopeType]}`
  token.contentEditable = 'false'
  token.dataset.role = 'scope-token'
  token.dataset.scopeKey = getScopeKey(scope)

  appendBadge(token, getScopeBadgeLabel(scope), TOKEN_BADGE_CLASSNAME[scope.scopeType])

  const label = document.createElement('span')
  label.className = 'max-w-[180px] truncate font-medium'
  label.textContent = scope.label
  token.appendChild(label)

  appendRemoveButton(token)
  return token
}

export const renderComposerNodesToEditor = (
  editor: HTMLElement,
  nodes: ComposerNode[]
): void => {
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
