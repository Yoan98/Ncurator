import type { HumanDeliveryMode, HumanState } from '../../types'
import { buildDeliveryModeFallbackMarkdown } from '../../shared/deliveryContracts'

export const buildFallbackDeliveryMarkdown = (input: {
  state: HumanState
  deliveryMode: HumanDeliveryMode
  summary: string
}): string =>
  buildDeliveryModeFallbackMarkdown({
    state: input.state,
    mode: input.deliveryMode,
    summary: input.summary
  })
