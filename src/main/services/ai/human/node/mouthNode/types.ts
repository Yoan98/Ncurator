import type { AiRunContext } from '../../../types'
import type { HumanResult, HumanState } from '../../types'

export type AiRunContextWithMouthOverride = AiRunContext & {
  resolveHumanDeliveryOverride?: (input: {
    userInput: string
    status: 'completed' | 'blocked'
    summary: string
    state: HumanState
  }) => HumanResult | undefined
}
