import type { JsonObject } from '../../../../../shared/types'
import type { HumanDecisionHint } from '../types'

const renderStringList = (items: readonly string[]): string =>
  items.length > 0 ? `[${items.join(', ')}]` : 'none'

const asJsonObject = (value: HumanDecisionHint['detail']): JsonObject => ({ ...value })

export const summarizeDecisionHint = (hint: HumanDecisionHint): string => {
  switch (hint.code) {
    case 'learning_no_effect':
      return `learning 本轮没有学到新 skill；requested=${renderStringList(
        hint.detail.requestedSkillIds
      )}；duplicate=${renderStringList(hint.detail.duplicateSkillIds)}；unknown=${renderStringList(
        hint.detail.unknownSkillIds
      )}。`
    case 'learning_builtin_skill_requested':
      return `learning 请求包含 builtin skill；requested=${renderStringList(
        hint.detail.requestedSkillIds
      )}；builtin=${renderStringList(hint.detail.builtinSkillIds)}。`
    case 'learning_tool_budget_exceeded':
      return `learning 请求会暴露 ${hint.detail.activeToolCount} 个 active tools，超过上限 ${hint.detail.limit}。`
    case 'hand_plan_invalid':
      return hint.detail.reason === 'hand_call_limit_exceeded'
        ? `hand 的 calls 超出单轮调用上限；tools=${renderStringList(
            hint.detail.offendingToolNames
          )}。`
        : `hand 的 docx 写 calls 在同一文件内包含多次写；sourcePaths=${renderStringList(
            hint.detail.sourcePaths || []
          )}；tools=${renderStringList(hint.detail.offendingToolNames)}。`
    case 'hand_approval_blocked':
      return `hand 的审批批次未全部通过；reason=${hint.detail.reason}；blockedCommands=${renderStringList(
        hint.detail.blockedCommands
      )}。`
    case 'hand_tool_limit_exceeded':
      return `hand 累计工具调用次数达到 ${hint.detail.toolCallCount}，已超过临时上限 ${hint.detail.limit}。`
    case 'hand_docx_positioned_write_blocked':
      return `hand 命中复杂定位排版保护；${hint.detail.targetDescription}不能自动编辑。`
    case 'hand_docx_batch_write_halted':
      return `hand 的 docx 批量写已安全停止；已完成 ${String(hint.detail.completedCallCount)}/${String(hint.detail.totalCallCount)} 个写操作，停止原因=${hint.detail.haltReason}。`
    case 'brain_todolist_incomplete':
      return `brain 选择 mouth 时 todolist 仍有未完成事项；pending=${renderStringList(
        hint.detail.pendingItems
      )}。`
  }
}

export const renderDecisionHintForBrain = (hint: HumanDecisionHint): string => {
  switch (hint.code) {
    case 'learning_no_effect':
      return [
        '上一轮 learning 没有产生新能力。',
        `requestedSkillIds=${renderStringList(hint.detail.requestedSkillIds)}`,
        `skippedDuplicateSkillIds=${renderStringList(hint.detail.duplicateSkillIds)}`,
        `skippedUnknownSkillIds=${renderStringList(hint.detail.unknownSkillIds)}`,
        '不要重复提交同样的 learning；只有当你能提出新的 skill 组合时才继续 learning。'
      ].join('\n')
    case 'learning_builtin_skill_requested':
      return [
        '上一轮 learning 请求了 builtin skill，因此未按该请求学习。',
        `requestedSkillIds=${renderStringList(hint.detail.requestedSkillIds)}`,
        `builtinSkillIds=${renderStringList(hint.detail.builtinSkillIds)}`,
        'builtin skill 始终可用，不应再提交到 learning；请直接决定是否调用其工具，或改为学习仍属 external 的 skill。'
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
        '上一轮 hand 的 calls 未通过执行前校验。',
        `reason=${hint.detail.reason}`,
        `offendingToolNames=${renderStringList(hint.detail.offendingToolNames)}`,
        hint.detail.sourcePaths
          ? `sourcePaths=${renderStringList(hint.detail.sourcePaths)}`
          : undefined,
        hint.detail.limit ? `limit=${String(hint.detail.limit)}` : undefined,
        hint.detail.callCount ? `requestedCallCount=${String(hint.detail.callCount)}` : undefined,
        hint.detail.reason === 'hand_call_limit_exceeded'
          ? '请缩减本轮 calls 数量，再重新决策。'
          : '同一文件一轮只能出现一次 docx 写工具调用。'
      ]
        .filter(Boolean)
        .join('\n')
    case 'hand_approval_blocked':
      return [
        '上一轮 hand 命中了审批批次，但本批没有全部通过，因此这些命令本轮没有执行。',
        `reason=${hint.detail.reason}`,
        `batchId=${hint.detail.batchId}`,
        `blockedToolNames=${renderStringList(hint.detail.blockedToolNames)}`,
        `blockedCommands=${renderStringList(hint.detail.blockedCommands)}`,
        `approvedItemIds=${renderStringList(hint.detail.approvedItemIds)}`,
        `rejectedItemIds=${renderStringList(hint.detail.rejectedItemIds)}`,
        `guidedItems=${hint.detail.guidedItems.length > 0 ? JSON.stringify(hint.detail.guidedItems) : 'none'}`,
        hint.detail.guidedItems.length > 0
          ? '你必须先吸收 guidedItems 里的用户指导内容，再决定下一步。'
          : undefined,
        hint.detail.rejectedItemIds.length > 0
          ? '这些被拒绝的命令不要原样再次提交同批内容。'
          : undefined
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
    case 'hand_docx_positioned_write_blocked':
      return [
        `上一轮命中了复杂定位排版保护，${hint.detail.targetDescription}不能自动编辑。`,
        '不要继续尝试修改这处区域，继续处理当前任务中其他仍可完成的部分。'
      ].join('\n')
    case 'hand_docx_batch_write_halted':
      return [
        '上一轮 docx 批量写在中途安全停止。',
        `sourcePath=${hint.detail.sourcePath}`,
        `lastSafeRevisionRef=${hint.detail.lastSafeRevisionRef}`,
        `completedCallCount=${String(hint.detail.completedCallCount)}`,
        `totalCallCount=${String(hint.detail.totalCallCount)}`,
        `haltedAtCallIndex=${String(hint.detail.haltedAtCallIndex)}`,
        `haltReason=${hint.detail.haltReason}`,
        `haltSummary=${hint.detail.haltSummary}`,
        `completedItems=${renderStringList(hint.detail.completedItems)}`,
        `pendingItems=${renderStringList(hint.detail.pendingItems)}`,
        `failedItem=${hint.detail.failedItem}`,
        `recoveryContext=${hint.detail.recoveryContext}`,
        '已完成部分已写入最新安全修订；未完成部分尚未执行。后续决策必须基于当前现状自主收敛。'
      ].join('\n')
    case 'brain_todolist_incomplete':
      return [
        '你上一轮选择了 mouth，但 todolist 里仍有未完成事项。',
        `pendingItems=${renderStringList(hint.detail.pendingItems)}`,
        '你必须先完成这些事项，或先更新 todolist 使这些事项不再是 todo，才能再次选择 mouth。在仍有 todo 时，禁止再次选择 mouth；优先处理剩余事项，不要继续扩写结束性叙述。'
      ].join('\n')
  }
}

export const renderDecisionHintDetail = (hint: HumanDecisionHint): JsonObject =>
  asJsonObject(hint.detail)
