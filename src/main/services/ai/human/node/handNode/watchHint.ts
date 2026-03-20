export const buildInvalidBatchHint = () =>
  'hand 收到不满足并行安全要求的工具批次，已返回 brain 重新决策。'

export const buildToolLimitHint = (toolCallCount: number, limit: number) =>
  `hand 累计工具调用次数达到 ${toolCallCount}，已超过临时上限 ${limit}，请优先考虑收敛。`
