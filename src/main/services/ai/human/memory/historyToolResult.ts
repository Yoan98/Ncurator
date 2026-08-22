import { extractArtifactRefsFromToolResult } from '../../utils/artifacts'
import type { HumanHistoryToolResult, ToolCallResult } from '../types'

export const buildHistoryToolResult = (result: ToolCallResult): HumanHistoryToolResult => {
  return {
    toolName: result.toolName,
    ok: result.ok,
    data: result.data,
    resourceContext: result.resourceContext,
    artifactRefs: (() => {
      const refs = extractArtifactRefsFromToolResult(result)
      return refs.length > 0 ? refs : undefined
    })()
  }
}
