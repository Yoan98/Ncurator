import type { KbAvailability, SelectedReference } from '../../../../shared/types'
import type { AiReferenceScope, AiRunStartPayload } from '../types'

const KB_AVAILABILITY_LABEL: Record<KbAvailability, string> = {
  indexed: '已索引',
  partial: '部分可检索',
  not_indexed: '未索引'
}

const renderSelectedReference = (reference: SelectedReference, index: number): string => {
  const kbDocumentIds =
    reference.kbDocumentIds.length > 0 ? reference.kbDocumentIds.join(', ') : 'none'

  if (reference.kind === 'web') {
    return [
      `${index}. [网页资料] ${reference.name}`,
      `   地址：${reference.url}`,
      `   知识库可用性：${KB_AVAILABILITY_LABEL[reference.kbAvailability]}`,
      `   kbDocumentIds：${kbDocumentIds}`
    ].join('\n')
  }

  const typeLabel = reference.kind === 'directory' ? '本地目录' : '本地文件'
  return [
    `${index}. [${typeLabel}] ${reference.relativePath}`,
    `   名称：${reference.name}`,
    `   知识库可用性：${KB_AVAILABILITY_LABEL[reference.kbAvailability]}`,
    `   kbDocumentIds：${kbDocumentIds}`
  ].join('\n')
}

const renderDocumentNarrowingText = (scope: AiReferenceScope): string => {
  const narrowedPairs = scope.selectedReferences
    .filter((reference) => reference.kbDocumentIds.length > 0)
    .map((reference, index) => {
      const label =
        reference.kind === 'web'
          ? `${index + 1}. [网页资料] ${reference.name}`
          : `${index + 1}. [${reference.kind === 'directory' ? '本地目录' : '本地文件'}] ${reference.name}`
      return `${label} -> [${reference.kbDocumentIds.join(', ')}]`
    })

  if (narrowedPairs.length === 0) {
    return [
      '缩圈状态：',
      '- 当前没有可直接缩圈的 kbDocumentIds。',
      '- 这只表示当前暂时不能按已选资料做 documentIds 缩圈，不表示默认知识库范围不可用。'
    ].join('\n')
  }

  return ['缩圈状态：', '- 当前已选参考资料对应的 kbDocumentIds：', ...narrowedPairs].join('\n')
}

export const buildReferenceScope = (input: {
  workspace?: AiRunStartPayload['workspace']
  selectedReferences?: SelectedReference[]
}): AiReferenceScope => {
  const selectedReferences = input.selectedReferences || []

  return {
    workspace: input.workspace,
    selectedReferences,
    hasExplicitSelectedReferences: selectedReferences.length > 0,
    hasDirectDocumentNarrowing: selectedReferences.some(
      (reference) => reference.kbDocumentIds.length > 0
    ),
    defaultKnowledgeScope: input.workspace ? 'current_workspace' : 'unavailable'
  }
}

export const renderReferenceScopeText = (scope: AiReferenceScope): string => {
  const workspaceLines = scope.workspace
    ? [
        `当前工作区绝对路径：${scope.workspace.rootPath}`,
        '后续所有本地文件路径、cwd 与生成产物路径，都必须位于该工作区内；未显式指定 cwd 时，默认从该工作区根目录开始。'
      ]
    : ['当前工作区：未绑定（仅内部兜底场景；正常 workbench 发送前会先选择工作区）。']

  const defaultScopeLines =
    scope.defaultKnowledgeScope === 'current_workspace'
      ? [
          '默认可用检索范围：',
          '- 当前工作区知识库中的可检索内容。',
          '- 这些内容来自该工作区下已建立索引的本地文件和网页资料。'
        ]
      : ['默认可用资料范围：', '- 未绑定工作区，不能假设存在可用的本地知识库默认范围。']

  const preferredReferenceLines = scope.hasExplicitSelectedReferences
    ? [
        '优先参考资料：',
        '- 当前已显式选择的参考资料可作为优先缩圈范围；如结果不足，可回到整个当前工作区范围继续检索。',
        ...scope.selectedReferences.map((reference, index) => renderSelectedReference(reference, index + 1))
      ]
    : [
        '优先参考资料状态：',
        '- 当前用户未显式指定优先参考资料。',
        '- 当前应先使用默认范围，而不要把这理解成无资料可查。'
      ]

  return [
    ...workspaceLines,
    '',
    ...defaultScopeLines,
    '',
    ...preferredReferenceLines,
    '',
    renderDocumentNarrowingText(scope)
  ].join('\n')
}
