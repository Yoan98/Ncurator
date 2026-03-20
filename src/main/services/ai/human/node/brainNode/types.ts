import type { AiRunContext } from '../../../types'
import type { LastBrainDecision } from '../../types'

export type AiRunContextWithBrainOverride = AiRunContext & {
  resolveBrainDecisionOverride?: () => LastBrainDecision | undefined
}
