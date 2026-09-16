export type AssistantThinkingWaitStatus = 'running' | 'completed' | 'failed' | 'partial_failed'

export type AssistantThinkingWaitGroup = {
  kind: string
  status: AssistantThinkingWaitStatus
  sourceEventType: string
  createdAt: number
}

export type AssistantThinkingWaitThought = {
  createdAt: number
}

export const isAssistantActivityToolGroup = (group: AssistantThinkingWaitGroup): boolean =>
  group.kind === 'skill' && group.sourceEventType !== 'thinking'

export type AssistantThinkingIndicatorInput = {
  isBrainThinking?: boolean
  waitingApproval?: boolean
  runFinished?: boolean
  hasFinalAnswer?: boolean
  /** Competing wait state: hide thinking while an LLM retry row is running. */
  hasRunningRetry?: boolean
}

/**
 * “让俺想想”展示判断规则：
 * - 请求时展示（isBrainThinking 为 true）；
 * - 出现「正在重试」时隐藏（与重试过程组互斥）；
 * - 结束时隐藏（收到输出、出错、run 结束、等待审批或已产出最终交付时隐藏）。
 */
export const shouldShowAssistantThinkingIndicator = (
  input: AssistantThinkingIndicatorInput
): boolean => {
  if (input.runFinished) return false
  if (input.waitingApproval) return false
  if (input.hasFinalAnswer) return false
  if (input.hasRunningRetry) return false
  return Boolean(input.isBrainThinking)
}

/**
 * 从消息日志记录中判断 Brain 思考状态窗口是否处于打开状态
 */
export const isBrainThinkingOpenInLog = (
  records: readonly { entry: { kind: string; eventType?: string } }[],
  runFinished?: boolean
): boolean => {
  if (runFinished) return false
  let open = false
  for (const record of records) {
    if (record.entry.kind === 'annotation') {
      if (record.entry.eventType === 'thinking_started') {
        open = true
      } else if (record.entry.eventType === 'thinking_completed') {
        open = false
      }
    }
  }
  return open
}

/**
 * Activity header keeps shimmer until the next AI content (Thought or final/streaming answer).
 */
export const shouldActivityHeaderShimmer = (input: {
  activityCreatedAt: number
  thoughts: readonly { createdAt: number }[]
  hasNextAiContent: boolean
}): boolean => {
  if (input.thoughts.some((thought) => thought.createdAt > input.activityCreatedAt)) return false
  if (input.hasNextAiContent) return false
  return true
}
