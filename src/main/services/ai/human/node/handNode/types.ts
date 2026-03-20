import type { AiRunContext } from '../../../types'
import type { JsonObject } from '../../../../../../shared/types'
import type { ToolCallResult } from '../../types'

export type AiRunContextWithToolOverride = AiRunContext & {
  resolveToolExecutionOverride?: (input: {
    toolName: string
    args: JsonObject
  }) => ToolCallResult | undefined
}
