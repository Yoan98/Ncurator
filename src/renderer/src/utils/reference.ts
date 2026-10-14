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
    ? `web:${reference.webSourceId}`
    : `${reference.kind}:${reference.workspaceId}:${reference.nodeId}`
