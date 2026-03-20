import type { AiTaskResultCode, JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'

export type AiRunContextWithFinalizeOverride = AiRunContext & {
  resolveHumanDeliveryOverride?: (input: {
    objective: string
    summary: string
    resultCode: AiTaskResultCode
    resultData?: JsonObject
  }) => string
}
