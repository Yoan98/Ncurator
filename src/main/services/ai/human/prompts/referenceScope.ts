import { renderSelectionLocation } from '../../../../../shared/documentSelection'
import { chatReferences } from '../../../../../shared/chatContent'
import type {
  ChatAttachment,
  ChatMessageContentNode,
  DocumentSelectionNode,
  KbAvailability,
  SelectedReference
} from '../../../../../shared/types'
import type { AiReferenceScope } from '../../types'

const KB_AVAILABILITY_LABEL: Record<KbAvailability, string> = {
  indexed: '已索引',
  partial: '部分可检索',
  not_indexed: '未索引'
}

type ReferencedDocument = {
  name: string
  address: string
  knowledge: { kbAvailability: KbAvailability; kbDocumentIds: string[] }
  wholeResource: boolean
  selections: DocumentSelectionNode[]
}

const renderAttachment = (attachment: ChatAttachment, index: number): string => {
  return `第 ${index} 个附件路径：${attachment.path}`
}

/** Generated boundaries do not trim or collapse the user's literal content. */
export const renderUserBlock = (label: string, content: string): string =>
  content ? `<${label}>\n${content}\n</${label}>` : ''

const renderSelection = (node: DocumentSelectionNode): string => {
  const anchor = node.anchor
  const parts = [renderSelectionLocation(node)]
  if (anchor?.kind !== 'ppt') {
    parts.push(renderUserBlock('选中内容', node.selectedText))
    if (anchor?.kind === 'text' && anchor.sourceText !== node.selectedText) {
      parts.push(renderUserBlock('源文件片段', anchor.sourceText))
    }
    parts.push(
      renderUserBlock('前文', node.contextBefore),
      renderUserBlock('后文', node.contextAfter)
    )
  }
  return renderUserBlock(`用户选中片段${node.number}`, parts.filter(Boolean).join('\n\n'))
}

export const buildReferenceScope = (input: {
  contentNodes?: ChatMessageContentNode[]
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
}): AiReferenceScope => ({
  contentNodes: input.contentNodes,
  selectedReferences: input.contentNodes
    ? chatReferences(input.contentNodes)
    : input.selectedReferences || [],
  attachments: input.attachments || []
})

export const renderSelectedReferencesText = (scope: AiReferenceScope): string => {
  const documents = new Map<string, ReferencedDocument>()
  const addReference = (reference: SelectedReference): void => {
    const address = reference.kind === 'web' ? reference.url : reference.absolutePath
    const existing = documents.get(address)
    documents.set(address, {
      name: reference.name,
      address,
      knowledge: reference,
      wholeResource: true,
      selections: existing?.selections || []
    })
  }
  for (const node of scope.contentNodes || []) {
    if (node.kind === 'reference') addReference(node.reference)
    if (node.kind !== 'document_selection') continue
    const address = node.filePath
    let document = documents.get(address)
    if (!document) {
      document = {
        address,
        name: address.split(/[/\\]/).pop() || address,
        knowledge: node.knowledge || { kbAvailability: 'not_indexed', kbDocumentIds: [] },
        wholeResource: false,
        selections: []
      }
      documents.set(address, document)
    }
    if (!document.selections.some((selection) => selection.id === node.id))
      document.selections.push(node)
    node.children.forEach((child) => {
      if (child.kind === 'reference') addReference(child.reference)
    })
  }
  if (!scope.contentNodes) scope.selectedReferences.forEach(addReference)
  return [...documents.values()]
    .map((document, index) => {
      const excerpts = document.selections.map(renderSelection).join('\n\n')
      return `${index + 1}. 文档：${document.name}
资源地址：${document.address}
文档知识库状态：${KB_AVAILABILITY_LABEL[document.knowledge.kbAvailability]}
知识库文档ID：${document.knowledge.kbDocumentIds.join(', ') || '无'}${document.wholeResource ? '\n引用内容：整个资源' : ''}${excerpts ? `\n\n${excerpts}` : ''}`
    })
    .join('\n\n')
}

export const renderAttachmentsText = (scope: AiReferenceScope): string =>
  (scope.attachments || [])
    .map((attachment, index) => renderAttachment(attachment, index + 1))
    .join('\n')
