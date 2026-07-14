import type { AiRunEvent } from '../../../../src/shared/types'

export const filterEventsByType = <TType extends AiRunEvent['type']>(
  events: readonly AiRunEvent[],
  type: TType
): Extract<AiRunEvent, { type: TType }>[] =>
  events.filter((event): event is Extract<AiRunEvent, { type: TType }> => event.type === type)
