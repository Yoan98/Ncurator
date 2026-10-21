import { t } from '../i18n'
import type { KbAvailability, SelectedReference } from '../../../shared/types'

const KB_AVAILABILITY_LABELS: Record<KbAvailability, string> = {
  indexed: t(($) => $.common.indexed),
  partial: t(($) => $.common.partiallySearchable),
  not_indexed: t(($) => $.common.notIndexed)
}

export const getKbAvailabilityLabel = (availability: KbAvailability): string =>
  KB_AVAILABILITY_LABELS[availability]

export const getReferenceKey = (reference: SelectedReference): string =>
  reference.kind === 'web'
    ? `web:${reference.webSourceId}`
    : `${reference.kind}:${reference.workspaceId}:${reference.nodeId}`
