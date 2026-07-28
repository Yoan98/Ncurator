import { describe, expect, it } from 'vitest'
import {
  HUMAN_DEFAULT_TOOL_CALL_LIMIT,
  HUMAN_GRAPH_RECURSION_LIMIT,
  HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO
} from '../../../../src/main/services/ai/human/constants'
import { HUMAN_GRAPH_INVOKE_CONFIG } from '../../../../src/main/services/ai/human/graph/humanGraph'
import {
  resolveHumanToolCallLimit,
  resolveHumanToolLimitWarningRatio
} from '../../../../src/main/services/ai/human/node/handNode'

describe('ai unit human runtime limits', () => {
  it('uses the production default tool-call limit unless a runtime override is provided', () => {
    expect(HUMAN_DEFAULT_TOOL_CALL_LIMIT).toBe(120)
    expect(resolveHumanToolCallLimit()).toBe(HUMAN_DEFAULT_TOOL_CALL_LIMIT)
    expect(resolveHumanToolCallLimit(7)).toBe(7)
    expect(HUMAN_TOOL_LIMIT_NEAR_EXHAUSTED_RATIO).toBe(0.8)
    expect(resolveHumanToolLimitWarningRatio()).toBe(0.8)
    expect(resolveHumanToolLimitWarningRatio(0.5)).toBe(0.5)
  })

  it('passes the production graph recursion limit to LangGraph invocation', () => {
    expect(HUMAN_GRAPH_RECURSION_LIMIT).toBe(200)
    expect(HUMAN_GRAPH_INVOKE_CONFIG).toEqual({
      recursionLimit: HUMAN_GRAPH_RECURSION_LIMIT
    })
  })
})
