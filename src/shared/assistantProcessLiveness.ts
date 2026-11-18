/**
 * 过程层「还活着」的唯一判定与动效归属。
 *
 * 运行期整轮只保留一处存活信号，挂在本轮最底部那一行上：
 * - 文字（Thought / 最终回答）→ 尾部呼吸黑球；
 * - Activity header → header 流光（从出现起保持到下段 AI content）；
 * - 自己会动的行（重试、压缩、子任务头像）→ 行内动效，不再加球；
 * - 还没有任何过程内容（冷启动）→ 过程区最下方单独一个黑球；
 * - 等待用户、失败、取消、结束 → 全部停止。
 */

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
  group.kind === 'toolset' && group.sourceEventType !== 'thinking'

export type AssistantRunAliveInput = {
  runFinished?: boolean
  waitingApproval?: boolean
  waitingInteraction?: boolean
  status?: 'running' | 'completed' | 'failed' | 'cancelled'
}

/** 本轮是否仍在推进：结束、等待用户、失败或取消时不再有任何存活动效。 */
export const isAssistantRunAlive = (input: AssistantRunAliveInput): boolean =>
  !input.runFinished &&
  !input.waitingApproval &&
  !input.waitingInteraction &&
  input.status !== 'failed' &&
  input.status !== 'cancelled'

export type AssistantLiveTailEntry = {
  kind: 'decision' | 'activity' | 'group'
  /** 该行自带动效（运行中的重试 / 压缩 / 子任务头像），不需要再挂球。 */
  selfAnimated?: boolean
}

export type AssistantLiveTailOwner = 'answer' | 'thought' | 'activity' | 'placeholder' | 'none'

/**
 * 存活信号挂在哪一行：
 * - `answer` / `thought`：底部文字尾部黑球；
 * - `activity`：Activity header 自己的流光负责，不加球；
 * - `placeholder`：过程区最下方单独一个黑球（冷启动、底部无可挂文字时）；
 * - `none`：等待用户、结束，或底部行自带行内动效。
 */
export const resolveAssistantLiveTailOwner = (input: {
  runAlive: boolean
  hasFinalAnswer: boolean
  hasStreamingThought: boolean
  lastEntry?: AssistantLiveTailEntry
}): AssistantLiveTailOwner => {
  if (!input.runAlive) return 'none'
  if (input.hasFinalAnswer) return 'answer'
  if (input.hasStreamingThought) return 'thought'
  if (input.lastEntry?.kind === 'decision') return 'thought'
  if (input.lastEntry?.kind === 'activity') return 'activity'
  if (input.lastEntry?.selfAnimated) return 'none'
  return 'placeholder'
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
 * Activity header 流光：从 Activity 出现起保持滑动，直到下一段 AI content
 * （Thought 或最终回答）出现；等待用户操作时停止。
 */
export const shouldActivityHeaderShimmer = (input: {
  activityCreatedAt: number
  thoughts: readonly { createdAt: number }[]
  hasNextAiContent: boolean
  waitingForUser?: boolean
}): boolean => {
  if (input.waitingForUser) return false
  if (input.thoughts.some((thought) => thought.createdAt > input.activityCreatedAt)) return false
  if (input.hasNextAiContent) return false
  return true
}
