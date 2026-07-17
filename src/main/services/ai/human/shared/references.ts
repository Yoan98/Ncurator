import type { HumanReference } from '../types'
import {
  buildNcuratorRefMarkdown as buildSharedNcuratorRefMarkdown,
  NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE,
  type NcuratorRefKind,
  type NcuratorRefResourceType
} from '../../../../../shared/ncuratorRef'

export { NCURATOR_REF_MARKDOWN_FORMAT_EXAMPLE }
export type { NcuratorRefKind, NcuratorRefResourceType }

export const buildNcuratorRefMarkdown = buildSharedNcuratorRefMarkdown

export const buildEvidenceReferenceMarkdown = (reference: HumanReference): string =>
  buildNcuratorRefMarkdown({ ...reference, kind: 'reference' })

export const buildNormalLinkMarkdown = (input: {
  label: string
  path: string
  resourceType: NcuratorRefResourceType
}): string => buildNcuratorRefMarkdown({ ...input, kind: 'normal' })

export const renderEvidenceReferences = (
  evidenceReferences: HumanReference[] | undefined
): string => {
  if (!evidenceReferences || evidenceReferences.length === 0) return 'none'
  return evidenceReferences
    .map(
      (reference, index) =>
        `${index + 1}. 引用资料：${reference.label}\n   - 支撑内容：${reference.usedFor}\n   - 资料地址：${reference.path}\n   - 资料类型：${inferReferenceSourceText(reference.resourceType)}\n   - 正文引用片段：${buildEvidenceReferenceMarkdown(reference)}`
    )
    .join('\n')
}

const inferReferenceSourceText = (resourceType: HumanReference['resourceType']): string =>
  resourceType === 'web' ? '网页资料' : '用户本地资料'
