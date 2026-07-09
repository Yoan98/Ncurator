import type { ChatAttachment, KbAvailability, SelectedReference } from '../../../../shared/types'
import type { AiReferenceScope, AiWorkspaceBinding } from '../types'

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
  reference.kind === 'web' ? reference.url : reference.relativePath

const renderSelectedReference = (reference: SelectedReference, index: number): string => {
  const kbDocumentIds =
    reference.kbDocumentIds.length > 0 ? reference.kbDocumentIds.join(', ') : '无'

  return `${index}. ${reference.name}
   类型：${getReferenceTypeLabel(reference)}
   资源地址：${getReferenceResourceAddress(reference)}
   文档知识库状态：${KB_AVAILABILITY_LABEL[reference.kbAvailability]}
   知识库文档ID：${kbDocumentIds}`
}

export const buildReferenceScope = (input: {
  workspace: AiWorkspaceBinding
  selectedReferences?: SelectedReference[]
  attachments?: ChatAttachment[]
}): AiReferenceScope => {
  const selectedReferences = input.selectedReferences || []

  return {
    workspace: input.workspace,
    selectedReferences,
    attachments: input.attachments || []
  }
}

const renderAttachment = (attachment: ChatAttachment, index: number): string => {
  return `第 ${index} 个附件：${attachment.name}
- 路径：${attachment.path}`
}

export const renderReferenceScopeText = (scope: AiReferenceScope): string => {
  const selectedReferences = scope.selectedReferences || []
  const attachments = scope.attachments || []
  const workspaceText = `工作区：
- 根目录：${scope.workspace.rootPath}
- 所有本地文件路径、cwd 和新生成的产物路径都必须位于这个工作区内。
- 如果没有显式指定 cwd，默认从工作区根目录开始。`

  const fieldGuideText = `字段说明：
- 类型：资料来源类型，目前支持本地文件、本地目录、网页资料。
- 资源地址：这份资料对应的本地路径或网页地址。
- 文档知识库状态：这份资料本身是否可被知识库检索。
- 知识库文档ID：这份资料在知识库中的文档标识；没有对应知识库文档时显示为“无”。`

  const selectedReferencesText =
    selectedReferences.length > 0
      ? `用户指定的参考范围：
${selectedReferences.map((reference, index) => renderSelectedReference(reference, index + 1)).join('\n')}`
      : `用户指定的参考范围：
- 当前没有用户显式指定的参考范围。`

  const attachmentsText =
    attachments.length > 0
      ? `用户添加的附件：
${attachments.map((attachment, index) => renderAttachment(attachment, index + 1)).join('\n\n')}`
      : `用户添加的附件：
- 当前没有用户添加的附件。`

  return `${workspaceText}

${fieldGuideText}

${selectedReferencesText}

${attachmentsText}`
}
