import type {
  ChatInlineContentNode,
  ChatMessageContentNode,
  DocumentSelectionNode,
  SelectedReference
} from './types'

export const selectionLabel = (node: DocumentSelectionNode): string =>
  `${node.filePath.split(/[/\\]/).pop() || node.filePath} · ${node.number}`

export const chatContentText = (nodes: readonly ChatMessageContentNode[]): string =>
  nodes
    .map((node) => {
      if (node.kind === 'text') return node.text
      if (node.kind === 'reference') return `@${node.reference.name}`
      return `[${selectionLabel(node)}] ${chatContentText(node.children)}`
    })
    .join('')

export const chatInlineNodes = (
  nodes: readonly ChatMessageContentNode[]
): ChatInlineContentNode[] =>
  nodes.flatMap((node) => (node.kind === 'document_selection' ? node.children : [node]))

export const chatReferences = (nodes: readonly ChatMessageContentNode[]): SelectedReference[] => {
  const references = new Map<string, SelectedReference>()
  for (const node of chatInlineNodes(nodes)) {
    if (node.kind !== 'reference') continue
    const reference = node.reference
    const key = reference.kind === 'web' ? reference.url : reference.absolutePath
    references.set(key, reference)
  }
  return [...references.values()]
}

export const documentSelections = (
  nodes: readonly ChatMessageContentNode[]
): DocumentSelectionNode[] =>
  nodes.filter((node): node is DocumentSelectionNode => node.kind === 'document_selection')

export const hasUserText = (nodes: readonly ChatMessageContentNode[]): boolean =>
  chatInlineNodes(nodes).some(
    (node) =>
      node.kind === 'text' && Boolean(node.text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim())
  )

export const persistentChatContent = (
  nodes: readonly ChatMessageContentNode[]
): ChatMessageContentNode[] => nodes.filter((node) => node.kind !== 'document_selection')
