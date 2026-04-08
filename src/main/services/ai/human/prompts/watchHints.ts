import type { JsonObject } from '../../../../../shared/types'
import type { HumanWatchHint } from '../types'

const renderStringList = (items: readonly string[]): string =>
  items.length > 0 ? `[${items.join(', ')}]` : 'none'

const asJsonObject = (value: HumanWatchHint['detail']): JsonObject => ({ ...value })

export const summarizeWatchHint = (hint: HumanWatchHint): string => {
  switch (hint.code) {
    case 'learning_no_effect':
      return `learning 本轮没有学到新 skill；requested=${renderStringList(
        hint.detail.requestedSkillIds
      )}；duplicate=${renderStringList(hint.detail.duplicateSkillIds)}；unknown=${renderStringList(
        hint.detail.unknownSkillIds
      )}。`
    case 'learning_tool_budget_exceeded':
      return `learning 请求会暴露 ${hint.detail.activeToolCount} 个 active tools，超过上限 ${hint.detail.limit}。`
    case 'hand_plan_invalid':
      return hint.detail.reason === 'parallel_limit_exceeded'
        ? `hand 的 parallel toolUsePlan 超出并行上限；tools=${renderStringList(
            hint.detail.offendingToolNames
          )}。`
        : `hand 的 parallel toolUsePlan 含不可并行工具；tools=${renderStringList(
            hint.detail.offendingToolNames
          )}。`
    case 'hand_tool_limit_exceeded':
      return `hand 累计工具调用次数达到 ${hint.detail.toolCallCount}，已超过临时上限 ${hint.detail.limit}。`
    case 'brain_invalid_mouth_transition':
      return 'brain 选择 mouth 时必须 readyToDeliver=true；当前结果仍未准备好收尾。'
  }
}

export const renderWatchHintForBrain = (hint: HumanWatchHint): string => {
  switch (hint.code) {
    case 'learning_no_effect':
      return [
        '上一轮 learning 没有产生新能力。',
        `requestedSkillIds=${renderStringList(hint.detail.requestedSkillIds)}`,
        `skippedDuplicateSkillIds=${renderStringList(hint.detail.duplicateSkillIds)}`,
        `skippedUnknownSkillIds=${renderStringList(hint.detail.unknownSkillIds)}`,
        '不要重复提交同样的 learning；只有当你能提出新的 skill 组合时才继续 learning。'
      ].join('\n')
    case 'learning_tool_budget_exceeded':
      return [
        '上一轮 learning 没有执行，因为 active tool budget 超限。',
        `requestedSkillIds=${renderStringList(hint.detail.requestedSkillIds)}`,
        `activeToolCount=${String(hint.detail.activeToolCount)}`,
        `activeToolLimit=${String(hint.detail.limit)}`,
        '请改成更聚焦的 skill 组合。'
      ].join('\n')
    case 'hand_plan_invalid':
      return [
        '上一轮 hand 的 toolUsePlan 不合法。',
        `mode=${hint.detail.mode}`,
        `reason=${hint.detail.reason}`,
        `offendingToolNames=${renderStringList(hint.detail.offendingToolNames)}`,
        hint.detail.limit ? `parallelLimit=${String(hint.detail.limit)}` : undefined,
        hint.detail.callCount ? `requestedCallCount=${String(hint.detail.callCount)}` : undefined,
        hint.detail.reason === 'parallel_requires_read_only'
          ? '如果包含写操作、需要最新执行结果，或工具不是只读并行安全，请改为 mode=serial。'
          : '请缩减并行读取工具数量，或改为 mode=serial。'
      ]
        .filter(Boolean)
        .join('\n')
    case 'hand_tool_limit_exceeded':
      return [
        '累计工具调用次数已经超过当前临时上限。',
        `toolCallCount=${String(hint.detail.toolCallCount)}`,
        `toolCallLimit=${String(hint.detail.limit)}`,
        '应优先考虑收敛；除非只差一次非常明确且必要的动作。'
      ].join('\n')
    case 'brain_invalid_mouth_transition':
      return [
        '你上一轮选择了 mouth，但 readyToDeliver=false。',
        '只要结果仍依赖未来工具动作，就不能选择 mouth。'
      ].join('\n')
  }
}

export const renderWatchHintForMouth = (hint: HumanWatchHint): string => {
  return summarizeWatchHint(hint)
}

export const renderWatchHintDetail = (hint: HumanWatchHint): JsonObject => asJsonObject(hint.detail)
