import type {
  KbAvailability,
  SelectedReference
} from '../../../../shared/types'
import type { ChatMessage } from '../../../types/store'
import type { AiRunStartPayload } from '../types'

const KB_AVAILABILITY_LABEL: Record<KbAvailability, string> = {
  indexed: '已索引',
  partial: '部分可检索',
  not_indexed: '未索引'
}

const toTrimmedStringList = (values: string[] | undefined): string[] =>
  Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : []

const normalizeKbAvailability = (value: string | undefined): KbAvailability =>
  value === 'indexed' || value === 'partial' || value === 'not_indexed' ? value : 'not_indexed'

const buildTypeDescriptionText = (): string =>
  [
    '参考资料类型说明：',
    '- 本地目录：工作区中的目录，可用于限定文件范围。',
    '- 本地文件：工作区中的具体文件。',
    '- 网页资料：当前工作区中已收录的网页内容。',
    '- 知识库可用性：',
    '  - 已索引：可直接通过知识库检索。',
    '  - 部分可检索：部分内容已索引，不能假设完整覆盖。',
    '  - 未索引：不能直接依赖知识库检索。'
  ].join('\n')

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

export const normalizeWorkspaceBinding = (
  workspace: AiRunStartPayload['workspace']
): AiRunStartPayload['workspace'] | undefined => {
  if (!workspace) return undefined

  const workspaceId = String(workspace.workspaceId || '').trim()
  const workspaceName = String(workspace.workspaceName || '').trim()
  const rootPath = String(workspace.rootPath || '').trim()
  if (!workspaceId || !workspaceName || !rootPath) return undefined

  return {
    workspaceId,
    workspaceName,
    rootPath,
    policyProfile: workspace.policyProfile ? String(workspace.policyProfile) : undefined
  }
}

export const normalizeSelectedReferences = (
  references: SelectedReference[] | undefined
): SelectedReference[] | undefined => {
  if (!Array.isArray(references)) return undefined

  const normalized = references
    .map((reference) => {
      if (reference.kind === 'web') {
        return {
          kind: 'web' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          webSourceId: String(reference.webSourceId || '').trim(),
          name: String(reference.name || '').trim(),
          url: String(reference.url || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability)
        }
      }

      if (reference.kind === 'directory') {
        return {
          kind: 'directory' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          nodeId: String(reference.nodeId || '').trim(),
          name: String(reference.name || '').trim(),
          relativePath: String(reference.relativePath || '').trim(),
          absolutePath: String(reference.absolutePath || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability),
          indexedFileCount: Math.max(0, Number(reference.indexedFileCount || 0)),
          notIndexedFileCount: Math.max(0, Number(reference.notIndexedFileCount || 0))
        }
      }

      return {
        kind: 'file' as const,
        workspaceId: String(reference.workspaceId || '').trim(),
        nodeId: String(reference.nodeId || '').trim(),
        name: String(reference.name || '').trim(),
        relativePath: String(reference.relativePath || '').trim(),
        absolutePath: String(reference.absolutePath || '').trim(),
        fileExt: reference.fileExt ? String(reference.fileExt).trim() : undefined,
        kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
        kbAvailability: normalizeKbAvailability(reference.kbAvailability)
      }
    })
    .filter((reference) => {
      if (reference.kind === 'web') {
        return Boolean(reference.workspaceId && reference.webSourceId && reference.name && reference.url)
      }

      return Boolean(
        reference.workspaceId &&
          reference.nodeId &&
          reference.name &&
          reference.relativePath &&
          reference.absolutePath
      )
    })

  return normalized.length > 0 ? normalized : undefined
}

const buildSelectedReferenceDocumentIdsText = (
  references: SelectedReference[]
): string => {
  const pairs = references
    .filter((reference) => reference.kbDocumentIds.length > 0)
    .map((reference, index) => {
      const label =
        reference.kind === 'web'
          ? `${index + 1}. [网页资料] ${reference.name}`
          : `${index + 1}. [${reference.kind === 'directory' ? '本地目录' : '本地文件'}] ${reference.name}`
      return `${label} -> [${reference.kbDocumentIds.join(', ')}]`
    })
  if (pairs.length === 0) {
    return '当前没有可直接缩圈的 kbDocumentIds；不带 documentIds 时默认搜索整个当前工作区知识库。'
  }
  return ['当前已选参考资料对应的 kbDocumentIds：', ...pairs].join('\n')
}

export const buildSelectedContextText = (input: {
  workspace?: AiRunStartPayload['workspace']
  selectedReferences?: SelectedReference[]
}): string => {
  const workspaceText = input.workspace
    ? [
        `当前工作区绝对路径：${input.workspace.rootPath}`,
        '后续所有本地文件路径、cwd 与生成产物路径，都必须位于该工作区内；未显式指定 cwd 时，默认从该工作区根目录开始。'
      ].join('\n')
    : '当前工作区：未绑定（仅内部兜底场景；正常 workbench 发送前会先选择工作区）。'

  const references = input.selectedReferences || []
  const kbScopeText = input.workspace
    ? [
        '知识库默认搜索范围：当前工作区下全部已导入资料（包括本地文件与网页资料）。',
        references.length > 0
          ? '当前已选参考资料只是优先缩圈候选；如结果不足，可回到整个当前工作区范围继续检索；若用户明确要求只看这些资料，则保持缩圈。'
          : '当前用户没有指定任何目录、文件或网页资料；若需要知识库检索，默认搜索当前工作区下全部已导入资料。'
      ].join('\n')
    : '知识库默认搜索范围：未绑定工作区，不能假设存在可用的本地知识库范围。'
  const selectedText =
    references.length > 0
      ? ['当前用户已指定以下参考资料：', ...references.map((reference, index) => renderSelectedReference(reference, index + 1))].join('\n')
      : '当前用户没有指定任何目录、文件或网页资料。'

  return [
    workspaceText,
    '',
    buildTypeDescriptionText(),
    '',
    kbScopeText,
    '',
    selectedText,
    '',
    buildSelectedReferenceDocumentIdsText(references)
  ].join('\n')
}

export const formatTurns = (messages: ChatMessage[]): string =>
  messages
    .map((message) => {
      const role = String(message.role || 'user')
      const content = String(message.content || '')
      return `${role}: ${content}`
    })
    .join('\n')
