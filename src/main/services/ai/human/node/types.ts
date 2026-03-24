import type { JsonObject } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type {
  HumanDeliveryMode,
  HumanState,
  LastBrainDecision,
  MouthOutput,
  ToolCallResult
} from '../types'

export type AiRunContextWithHumanOverrides = AiRunContext & {
  resolveBrainDecisionOverride?: () => LastBrainDecision | undefined
  resolveToolExecutionOverride?: (input: {
    toolName: string
    args: JsonObject
  }) => ToolCallResult | undefined
  resolveHumanDeliveryOverride?: (input: {
    userInput: string
    deliveryMode: HumanDeliveryMode
    summary: string
    state: HumanState
  }) => MouthOutput | undefined
}
