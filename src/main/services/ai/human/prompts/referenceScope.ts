import type { ChatAttachment, KbAvailability, SelectedReference } from '../../../../../shared/types'
import type { AiReferenceScope } from '../../types'

const KB_AVAILABILITY_LABEL: Record<KbAvailability, string> = {
  indexed: '已索引',
  partial: '部分可检索',
  not_indexed: '未索引'
}

const getReferenceTypeLabel = (reference: SelectedReference): string => {
  if (reference.kind === 'web') return '网页资料'
  if (reference.kind === 'directory') return '本地目录'
  return '本地文件'
}

const getReferenceResourceAddress = (reference: SelectedReference): string =>
  reference.kind === 'web' ? reference.url : reference.absolutePath

const renderSelectedReference = (reference: SelectedReference, index: number): string => {
  const kbDocumentIds =
    reference.kbDocumentIds.length > 0 ? reference.kbDocumentIds.join(', ') : '无'

  return `${index}. ${reference.name}
   类型：${getReferenceTypeLabel(reference)}
   资源地址：${getReferenceResourceAddress(reference)}
   文档知识库状态：${KB_AVAILABILITY_LABEL[reference.kbAvailability]}
   知识库文档ID：${kbDocumentIds}`
}

const renderAttachment = (attachment: ChatAttachment, index: number): string => {
  return `第 ${index} 个附件：${attachment.name}
- 路径：${attachment.path}`
}

const renderOptionalUserBlock = (title: string, body: string): string => {
  const content = body.trim()
  if (!content) return ''
  return `${title}：
${content}`
}

export const buildReferenceScope = (input: {
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
}): AiReferenceScope => ({
  selectedReferences: input.selectedReferences || [],
  attachments: input.attachments || []
})

export const renderSelectedReferencesText = (scope: AiReferenceScope): string =>
  (scope.selectedReferences || [])
    .map((reference, index) => renderSelectedReference(reference, index + 1))
    .join('\n')

export const renderAttachmentsText = (scope: AiReferenceScope): string =>
  (scope.attachments || [])
    .map((attachment, index) => renderAttachment(attachment, index + 1))
    .join('\n\n')

export const renderReferenceScopeText = (scope: AiReferenceScope): string =>
  [
    renderOptionalUserBlock('用户@的参考资料', renderSelectedReferencesText(scope)),
    renderOptionalUserBlock('用户添加的附件', renderAttachmentsText(scope))
  ]
    .filter((block) => block.length > 0)
    .join('\n\n')
