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

/**
 * 「让俺想想」只在段内尚无工具时展示：
 * - 本 turn 首次（尚无 Thought / Activity），或
 * - 上一段 AI content（Thought）之后、下一组工具出现之前。
 * Activity 运行中、正在重试、或已有流式/最终正文时不展示；上一段若以 Activity 收尾则不再插 think 行。
 */
export const shouldShowAssistantThinkingWait = (input: {
  processGroups: readonly AssistantThinkingWaitGroup[]
  processThoughts: readonly AssistantThinkingWaitThought[]
  hasVisibleBrainOutput?: boolean
}): boolean => {
  if (input.hasVisibleBrainOutput) return false
  if (input.processGroups.some((group) => group.kind === 'retry' && group.status === 'running')) {
    return false
  }
  if (
    input.processGroups.some(
      (group) => isAssistantActivityToolGroup(group) && group.status === 'running'
    )
  ) {
    return false
  }

  const products = [
    ...input.processThoughts.map((thought) => ({
      createdAt: thought.createdAt,
      kind: 'thought' as const
    })),
    ...input.processGroups
      .filter((group) => group.kind !== 'thinking')
      .map((group) => ({
        createdAt: group.createdAt,
        kind: isAssistantActivityToolGroup(group) ? ('activity' as const) : ('other' as const)
      }))
  ].sort((left, right) => left.createdAt - right.createdAt)

  if (products.length === 0) return true
  return products[products.length - 1]?.kind === 'thought'
}

export const visibleAssistantProcessGroups = <T extends AssistantThinkingWaitGroup>(input: {
  processGroups: readonly T[]
  processThoughts: readonly AssistantThinkingWaitThought[]
  hasVisibleBrainOutput?: boolean
}): T[] => {
  const groups = [...input.processGroups]
  if (shouldShowAssistantThinkingWait(input)) return groups
  return groups.filter((group) => group.kind !== 'thinking')
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
