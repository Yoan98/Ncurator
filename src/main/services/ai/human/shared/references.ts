import type { HumanReference } from '../types'

const normalizePath = (value: string): string => value.trim()

export type NcuratorRefKind = 'reference' | 'normal'
export type NcuratorRefResourceType = HumanReference['resourceType']

export const buildNcuratorRefMarkdown = (input: {
  label: string
  path: string
  resourceType: NcuratorRefResourceType
  kind: NcuratorRefKind
}): string => {
  const params = new URLSearchParams({
    kind: input.kind,
    resourceType: input.resourceType,
    label: input.label,
    path: normalizePath(input.path)
  })
  return `[${input.label}](ncurator://ref?${params.toString()})`
}

export const NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE = buildNcuratorRefMarkdown({
  label: '资料名称',
  path: '/workspace/资料.docx',
  resourceType: 'file',
  kind: 'reference'
})

export const buildReferenceMarkdown = (reference: HumanReference): string =>
  buildNcuratorRefMarkdown({ ...reference, kind: 'reference' })

export const buildNormalLinkMarkdown = (input: {
  label: string
  path: string
  resourceType: NcuratorRefResourceType
}): string => buildNcuratorRefMarkdown({ ...input, kind: 'normal' })

export const renderHumanReferences = (references: HumanReference[] | undefined): string => {
  if (!references || references.length === 0) return 'none'
  return references
    .map(
      (reference, index) =>
        `${index + 1}. 引用资料：${reference.label}\n   - 支撑内容：${reference.usedFor}\n   - 资料地址：${reference.path}\n   - 资料类型：${inferReferenceSourceText(reference.resourceType)}\n   - 正文引用片段：${buildReferenceMarkdown(reference)}`
    )
    .join('\n')
}

const inferReferenceSourceText = (resourceType: HumanReference['resourceType']): string =>
  resourceType === 'web' ? '网页资料' : '用户本地资料'

export const inferReferenceIconKind = (input: {
  resourceType: HumanReference['resourceType']
}): 'web' | 'file' => (input.resourceType === 'web' ? 'web' : 'file')
