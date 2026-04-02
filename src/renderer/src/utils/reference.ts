import type { KbAvailability, SelectedReference } from '../../../shared/types'

const KB_AVAILABILITY_LABELS: Record<KbAvailability, string> = {
  indexed: '已索引',
  partial: '部分可检索',
  not_indexed: '未索引'
}

export const getKbAvailabilityLabel = (availability: KbAvailability): string =>
  KB_AVAILABILITY_LABELS[availability]

export const getReferenceKey = (reference: SelectedReference): string =>
  reference.kind === 'web'
    ? `web:${reference.workspaceId}:${reference.webSourceId}`
    : `${reference.kind}:${reference.workspaceId}:${reference.nodeId}`

export const getReferenceTypeLabel = (reference: SelectedReference): string => {
  if (reference.kind === 'directory') return '目录'
  if (reference.kind === 'file') return '文件'
  return '网页'
}

export const getReferenceDisplayPath = (reference: SelectedReference): string =>
  reference.kind === 'web' ? reference.url : reference.relativePath

export const getReferenceBadgeLabel = (reference: SelectedReference): string => {
  if (reference.kind === 'directory') return 'DIR'
  if (reference.kind === 'web') return 'WEB'
  const ext = (reference.fileExt || reference.relativePath.split('.').pop() || '').trim()
  return ext ? ext.replace(/^\./, '').slice(0, 4).toUpperCase() : 'FILE'
}

export const collectReferenceDocumentIds = (references: SelectedReference[]): string[] =>
  Array.from(
    new Set(
      references.flatMap((reference) =>
        Array.isArray(reference.kbDocumentIds)
          ? reference.kbDocumentIds.map((item) => String(item).trim())
          : []
      )
    )
  ).filter(Boolean)

export const pruneReferencesByWorkspace = (
  references: SelectedReference[],
  workspaceId: string | null
): SelectedReference[] =>
  references.filter((reference) => reference.workspaceId === workspaceId)

export const hasIncompleteLocalKbCoverage = (reference: SelectedReference): boolean =>
  reference.kind !== 'web' && reference.kbAvailability !== 'indexed'
