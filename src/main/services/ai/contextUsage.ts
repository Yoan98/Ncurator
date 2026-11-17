import type { AiContextUsageBasis, BrainContextBudgetSnapshot } from '../../../shared/types'
import type { ChatMessageLogStore } from '../storage/domains/ChatMessageLogStore'
import type { WorkbenchUiStore } from '../storage/domains/WorkbenchUiStore'
import { resolveEffectiveContextWindowTokens } from './human/constants'
import { projectMessageLogRecords } from './human/memory/transcript'
import { estimateMessagesForContext } from './human/memory/multimodal'
import { lookupCatalogModelContextTokens } from './modelContextWindow'
import { hasEffectiveImageContextInMessageLog } from '../../../shared/messageLogVisionContext'

export type AiContextUsage = {
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  basis: AiContextUsageBasis
  updatedAt: number
  hasEffectiveImageContext: boolean
}

/**
 * 上下文用量展示。
 *
 * - 有主会话预算快照时，已用量直接用当轮判定过的 `budgetTokens`（真实 brain usage + 增量），
 *   和 compaction 触发是同一个数；分母仍由同一个公式现算，保证与判定同口径。
 * - 没有快照（新会话 / 应用刚启动还没跑过）时退回消息估算，并把 `basis` 标成 `estimate`。
 */
export const getAiContextUsage = async (input: {
  partnerId: string
  chatMessageLogStore: ChatMessageLogStore
  workbenchUiStore: WorkbenchUiStore
  contextBudget?: BrainContextBudgetSnapshot
}): Promise<AiContextUsage> => {
  const records = await input.chatMessageLogStore.listForModel(input.partnerId)
  const partnerState = await input.workbenchUiStore.getPartnerState(input.partnerId)
  const contextWindowTokens = resolveEffectiveContextWindowTokens(
    await lookupCatalogModelContextTokens(partnerState?.composer.modelSelection.mainModel)
  )
  const usedContextTokens =
    input.contextBudget?.budgetTokens ??
    estimateMessagesForContext(
      projectMessageLogRecords(records, { includeUserEntries: true }).messages
    )
  return {
    contextWindowTokens,
    usedContextTokens,
    ratio: usedContextTokens / contextWindowTokens,
    basis: input.contextBudget?.basis ?? 'estimate',
    updatedAt: Date.now(),
    hasEffectiveImageContext: hasEffectiveImageContextInMessageLog(records)
  }
}
