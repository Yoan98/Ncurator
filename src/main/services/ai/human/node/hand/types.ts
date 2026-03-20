import type { AiTaskResultCode, JsonObject, JsonValue } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'

export type ToolOutcome = {
  ok: boolean
  code: AiTaskResultCode
  summary: string
  data?: JsonValue
}

export type AiRunContextWithToolOverride = AiRunContext & {
  resolveToolExecutionOverride?: (input: {
    toolName: string
    args: JsonObject
  }) => ToolOutcome | undefined
}
