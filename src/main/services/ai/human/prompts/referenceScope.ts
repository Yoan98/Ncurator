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
  const locatorOnly = anchor?.kind === 'ppt' || anchor?.kind === 'excel'
  const positioning = [renderSelectionPosition(node)]
  if (!locatorOnly) {
    const fragments: string[] = []
    if (anchor?.kind === 'text' && anchor.sourceText !== node.selectedText) {
      fragments.push(renderUserBlock('源文件片段', anchor.sourceText))
    }
    fragments.push(
      renderUserBlock('选中内容的前文', node.contextBefore),
      renderUserBlock('选中内容的后文', node.contextAfter)
    )
    if (fragments.some(Boolean)) positioning.push('以下片段仅用于定位。', ...fragments)
  }
  const parts = [
    locatorOnly ? '' : renderUserBlock('选中内容', node.selectedText),
    renderUserBlock('定位信息', positioning.filter(Boolean).join('\n\n'))
  ]
  return renderUserBlock(`用户选中片段${node.number}`, parts.filter(Boolean).join('\n\n'))
}

const renderSelectionPosition = (node: DocumentSelectionNode): string => {
  const anchor = node.anchor
  if (!anchor) return ''
  switch (anchor.kind) {
    case 'text':
      return anchor.startLine === anchor.endLine
        ? `行号：第 ${anchor.startLine} 行`
        : `行号：第 ${anchor.startLine}–${anchor.endLine} 行`
    case 'pdf':
      return anchor.startPage === anchor.endPage
        ? `页码：第 ${anchor.startPage} 页`
        : `页码：第 ${anchor.startPage}–${anchor.endPage} 页`
    case 'ppt':
      return [
        `页码：第 ${anchor.page} 页`,
        anchor.mode === 'element' ? `选中元素：${anchor.elementId}` : `选中页面：${anchor.slideId}`
      ].join('\n')
    case 'excel':
      return `工作表：${anchor.sheetName}\n单元格范围：${anchor.range}`
  }
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
