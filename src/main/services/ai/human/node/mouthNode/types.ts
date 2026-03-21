import type { AiRunContext } from '../../../types'
import type { HumanDeliveryMode, MouthOutput, HumanState } from '../../types'

export type AiRunContextWithMouthOverride = AiRunContext & {
  resolveHumanDeliveryOverride?: (input: {
    userInput: string
    deliveryMode: HumanDeliveryMode
    status: 'completed' | 'blocked'
    summary: string
    state: HumanState
  }) => MouthOutput | undefined
}
