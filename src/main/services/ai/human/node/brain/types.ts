import type { AiRunContext } from '../../../types'
import type { HumanReasoningOutput } from '../../types'

export type AiRunContextWithReasonOverride = AiRunContext & {
  resolveHumanReasonOverride?: () => HumanReasoningOutput | undefined
}
