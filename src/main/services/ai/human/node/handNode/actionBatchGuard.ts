import { canBatchPlan } from './toolExecutionMeta'
import type { ToolCallParam } from '../../types'

const MAX_PARALLEL_TOOL_CALLS = 4

export const validateParallelToolCalls = (parallelCallToolParam: ToolCallParam[]): boolean => {
  return canBatchPlan({
    actions: parallelCallToolParam.map((item) => ({
      toolName: item.toolName,
      args: item.args
    })),
    maxParallel: MAX_PARALLEL_TOOL_CALLS
  })
}
