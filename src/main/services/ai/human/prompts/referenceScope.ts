import { selectionPosition } from '../../../../../shared/documentSelection'
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

const renderExcerptBlock = (label: string, content: string): string => {
  const longestFence = (content.match(/`+/g) || []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0
  )
  const fence = '`'.repeat(Math.max(3, longestFence + 1))
  return `${label}：\n${fence}text\n${content}\n${fence}`
}

const renderSelection = (node: DocumentSelectionNode): string => {
  const label = `选中片段${node.number}`
  return [
    selectionPosition(node) ? `${label}的位置：${selectionPosition(node)}` : '',
    node.anchor?.kind === 'ppt'
      ? `页面标识：${node.anchor.slideId}${node.anchor.elementId ? `；元素标识：${node.anchor.elementId}` : ''}`
      : '',
    node.anchor?.kind === 'text' && node.anchor.sourceText !== node.selectedText
      ? renderExcerptBlock('对应的源文件片段（定位用）', node.anchor.sourceText)
      : '',
    node.image ? `选中时的画面：${node.image.path}` : '',
    renderExcerptBlock(`${label}的原文`, node.selectedText),
    renderExcerptBlock(`${label}的前文（上下文，仅供理解与定位）`, node.contextBefore),
    renderExcerptBlock(`${label}的后文（上下文，仅供理解与定位）`, node.contextAfter)
  ]
    .filter(Boolean)
    .join('\n\n')
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
